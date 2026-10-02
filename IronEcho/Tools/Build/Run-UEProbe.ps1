<#
.SYNOPSIS
  Runs Tools/Unreal/Tech/ue_connection_probe.py in a headless editor (PythonScriptCommandlet) and keeps
  the actual log in Saved/Logs/Probe and a copy of the result in Docs/Reports.
#>
param([switch]$KeepReport = $true)

. (Join-Path $PSScriptRoot 'Common.ps1')
$editorCmd = Get-EditorCmd
$probeScript = Join-Path $script:ProjectRoot 'Tools\Unreal\Tech\ue_connection_probe.py'
$stamp = New-Timestamp
$log = Join-Path $script:SavedDir "Logs\Probe\ue_probe_$stamp.log"

Write-Step "Editor Python probe ($editorCmd)"
$argLine = (Quote $script:UProject) + ' -run=pythonscript -script=' + (Quote $probeScript) + ' -unattended -nop4 -nosplash -NullRHI -stdout -FullStdOutLogOutput'
$code = Invoke-Logged -Exe $editorCmd -ArgumentLine $argLine -LogFile $log

$resultFile = Join-Path $script:SavedDir 'Probe\ue_probe_result.json'
$probeLines = @(Select-String -Path $log -Pattern 'IRONECHO_PROBE' | ForEach-Object { $_.Line })
if ($probeLines.Count -eq 0 -or -not (Test-Path $resultFile)) {
    Write-Fail "probe did not run (exit $code). Log: $log"
    exit 1
}
$result = Get-Content -Raw $resultFile | ConvertFrom-Json
if ($KeepReport) {
    $reports = Join-Path $script:ProjectRoot 'Docs\Reports'
    Copy-Item $resultFile (Join-Path $reports "ue_probe_result_$stamp.json") -Force
    $probeLines | Set-Content -Encoding UTF8 (Join-Path $reports "ue_probe_log_$stamp.txt")
}
if ($result.ok) { Write-Ok "probe OK (engine $($result.engine_version)); log $log"; exit 0 }
Write-Fail "probe reported problems; see $resultFile"
exit 2
