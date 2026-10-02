<#
.SYNOPSIS
  Reproducible technical test suite on Windows:
    1. ownership blocks in AGENTS.md / CLAUDE.md are current
    2. core rules + protocol (CMake, MSVC /W4 /WX, no exceptions/RTTI like Unreal)
    3. tracker (pytest) + packaged-style selftest
    4. optional: Unreal automation tests (-Unreal)
#>
param([switch]$Unreal)

. (Join-Path $PSScriptRoot 'Common.ps1')
$stamp = New-Timestamp
$logs = Join-Path $script:SavedDir "Logs\Tests\$stamp"
$failures = @()

Write-Step 'Ownership blocks'
$python = Get-TrackerPython
if ((Invoke-Logged -Exe $python -ArgumentLine 'Tools\Build\ownership.py verify' -LogFile "$logs\ownership.log") -ne 0) { $failures += 'ownership' }

Write-Step 'Core rules (CMake)'
$cmake = Find-CMake
if (-not $cmake) {
    Write-Warn2 'cmake not found (install the VS "C++ CMake tools" component)'; $failures += 'cmake-missing'
} else {
    $build = Join-Path $script:ProjectRoot 'Build\CoreRulesTests'
    $ok = (Invoke-Logged -Exe $cmake -ArgumentLine ('-S Tests\CoreRules -B ' + (Quote $build)) -LogFile "$logs\cmake-configure.log") -eq 0
    if ($ok) { $ok = (Invoke-Logged -Exe $cmake -ArgumentLine ('--build ' + (Quote $build) + ' --config Release') -LogFile "$logs\cmake-build.log") -eq 0 }
    $exe = Join-Path $build 'Release\CoreRulesTests.exe'
    if ($ok -and (Test-Path $exe)) { $ok = (Invoke-Logged -Exe $exe -LogFile "$logs\core-tests.log") -eq 0 } else { $ok = $false }
    if (-not $ok) { $failures += 'core-rules' }
}

Write-Step 'Tracker (pytest + selftest)'
if ((Invoke-Logged -Exe $python -ArgumentLine '-m pytest -q' -LogFile "$logs\pytest.log" -WorkingDirectory (Join-Path $script:ProjectRoot 'Tracking')) -ne 0) { $failures += 'pytest' }
if ((Invoke-Logged -Exe $python -ArgumentLine '-m iron_echo_tracker selftest' -LogFile "$logs\selftest.log" -WorkingDirectory (Join-Path $script:ProjectRoot 'Tracking')) -ne 0) { $failures += 'selftest' }

Write-Step 'Tool tests (robot contract checks)'
if ((Invoke-Logged -Exe $python -ArgumentLine '-m pytest -q Tests\Tools' -LogFile "$logs\tools-tests.log") -ne 0) { $failures += 'tool-tests' }

if ($Unreal) {
    Write-Step 'Unreal automation tests (IronEcho.*)'
    $report = Join-Path $logs 'ue-automation'
    $argLine = (Quote $script:UProject) + ' -ExecCmds="Automation RunTests IronEcho; Quit" -unattended -nop4 -nosplash -NullRHI -stdout -ReportExportPath=' + (Quote $report) + ' -TestExit="Automation Test Queue Empty"'
    if ((Invoke-Logged -Exe (Get-EditorCmd) -ArgumentLine $argLine -LogFile "$logs\ue-automation.log") -ne 0) { $failures += 'unreal-automation' }
}

if ($failures.Count -gt 0) { Write-Fail ("failed: " + ($failures -join ', ') + "  logs: $logs"); exit 1 }
Write-Ok "all tests passed; logs: $logs"
