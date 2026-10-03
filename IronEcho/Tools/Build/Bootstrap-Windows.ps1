<#
.SYNOPSIS
  One-command setup and verification of the IRON ECHO development machine (Windows x64).

  1. Measures hardware (OS, CPU, RAM, GPU + real VRAM, cameras).
  2. Detects Unreal Engine, Visual Studio/MSVC + Windows SDK, Blender, Python 3.12, Git/LFS.
  3. Writes Tools/local.settings.json (gitignored; no machine paths in shared files).
  4. Creates Tracking/.venv, installs pinned requirements, downloads + verifies MediaPipe models.
  5. Runs technical tests (ownership, core rules via CMake/MSVC, tracker pytest + selftest).
  6. Lists cameras through OpenCV (what the tracker will actually see).
  7. Aligns IronEcho.uproject EngineAssociation with the installed engine, builds IronEchoEditor.
  8. Runs the editor Python probe (ue_connection_probe.py) and keeps the real log.
  9. Writes Docs/Reports/<date>_env_windows.md for PROJECT_STATE.md.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File Tools\Build\Bootstrap-Windows.ps1
  powershell -ExecutionPolicy Bypass -File Tools\Build\Bootstrap-Windows.ps1 -EngineVersion 5.8 -SkipUnrealBuild
#>
param(
    [string]$EngineVersion = '',
    [switch]$SkipUnrealBuild,
    [switch]$SkipProbe,
    [switch]$SkipTests
)

. (Join-Path $PSScriptRoot 'Common.ps1')
$stamp = New-Timestamp
$bootDir = Join-Path $script:SavedDir "Bootstrap\$stamp"
New-Item -ItemType Directory -Force -Path $bootDir | Out-Null
$report = [ordered]@{ started = (Get-Date).ToString('s'); steps = [ordered]@{} }

function Set-StepResult([string]$Name, [string]$Status, $Detail) {
    $report.steps[$Name] = [ordered]@{ status = $Status; detail = $Detail }
    if ($Status -eq 'ok') { Write-Ok "$Name : $Detail" } elseif ($Status -eq 'warn') { Write-Warn2 "$Name : $Detail" } else { Write-Fail "$Name : $Detail" }
}

# ---------------------------------------------------------------- 1. hardware
Write-Step 'Hardware'
& (Join-Path $PSScriptRoot 'Measure-Hardware.ps1') -OutDir $bootDir | Out-Null
$hw = Get-Content -Raw (Join-Path $bootDir 'hardware.json') | ConvertFrom-Json
$report.hardware = $hw
Set-StepResult 'hardware' 'ok' ("{0}; {1}; {2} GiB RAM" -f $hw.os, $hw.cpu, $hw.ram_gib)
foreach ($gpu in @($hw.gpus)) { Set-StepResult ('gpu ' + $gpu.name) 'ok' ("VRAM {0} MiB via {1}, driver {2}" -f $gpu.vram_mib, $gpu.source, $gpu.driver) }
if (@($hw.cameras).Count -eq 0) { Set-StepResult 'camera devices' 'warn' 'no camera device reported by Windows' }
else { Set-StepResult 'camera devices' 'ok' ((@($hw.cameras) | ForEach-Object { $_.name }) -join '; ') }

# ---------------------------------------------------------------- 2. tools
Write-Step 'Unreal Engine'
$engines = @()
$launcherDat = Join-Path $env:ProgramData 'Epic\UnrealEngineLauncher\LauncherInstalled.dat'
if (Test-Path $launcherDat) {
    $installed = (Get-Content -Raw $launcherDat | ConvertFrom-Json).InstallationList
    foreach ($item in @($installed)) {
        if ($item.AppName -like 'UE_*') { $engines += [ordered]@{ root = $item.InstallLocation; source = 'launcher'; association = $item.AppName.Substring(3) } }
    }
}
Get-ChildItem 'HKLM:\SOFTWARE\EpicGames\Unreal Engine' -ErrorAction SilentlyContinue | ForEach-Object {
    $dir = (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).InstalledDirectory
    if ($dir -and -not ($engines | Where-Object { $_.root -eq $dir })) { $engines += [ordered]@{ root = $dir; source = 'registry'; association = $_.PSChildName } }
}
$builds = Get-ItemProperty 'HKCU:\SOFTWARE\Epic Games\Unreal Engine\Builds' -ErrorAction SilentlyContinue
if ($builds) {
    foreach ($prop in $builds.PSObject.Properties) {
        if ($prop.Name -notlike 'PS*') { $engines += [ordered]@{ root = $prop.Value; source = 'source-build'; association = $prop.Name } }
    }
}
$engineInfo = $null
foreach ($engine in $engines) {
    $versionFile = Join-Path $engine.root 'Engine\Build\Build.version'
    $editor = Join-Path $engine.root 'Engine\Binaries\Win64\UnrealEditor.exe'
    if ((Test-Path $versionFile) -and (Test-Path $editor)) {
        $v = Get-Content -Raw $versionFile | ConvertFrom-Json
        $engine.version = "$($v.MajorVersion).$($v.MinorVersion).$($v.PatchVersion)"
        $engine.majorMinor = "$($v.MajorVersion).$($v.MinorVersion)"
        $engine.changelist = $v.Changelist
        if (-not $EngineVersion -or $engine.majorMinor -eq $EngineVersion) {
            if (-not $engineInfo -or [version]$engine.version -gt [version]$engineInfo.version) { $engineInfo = $engine }
        }
    }
}
if ($engineInfo) {
    Set-StepResult 'unreal' 'ok' ("{0} at {1} ({2})" -f $engineInfo.version, $engineInfo.root, $engineInfo.source)
} else {
    Set-StepResult 'unreal' 'fail' 'no Unreal Engine 5 installation found (Epic Games Launcher > Unreal Engine > Library)'
}

Write-Step 'Visual Studio / MSVC / Windows SDK'
$vsInfo = $null
$vswhere = Find-VsWhere
if ($vswhere) {
    $vsJson = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json 2>$null | ConvertFrom-Json
    if ($vsJson) {
        $vs = @($vsJson)[0]
        $msvc = @(Get-ChildItem (Join-Path $vs.installationPath 'VC\Tools\MSVC') -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | ForEach-Object { $_.Name })
        $vsInfo = [ordered]@{ name = $vs.displayName; version = $vs.installationVersion; path = $vs.installationPath; msvc = $msvc }
        Set-StepResult 'visual studio' 'ok' ("{0} {1}; MSVC {2}" -f $vs.displayName, $vs.installationVersion, ($msvc -join ', '))
    }
}
if (-not $vsInfo) { Set-StepResult 'visual studio' 'fail' 'Visual Studio with "Desktop development with C++" / "Game development with C++" not found' }
$sdkRoot = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots' -ErrorAction SilentlyContinue).KitsRoot10
$sdks = @()
if ($sdkRoot) { $sdks = @(Get-ChildItem (Join-Path $sdkRoot 'Include') -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) }
if ($sdks.Count -gt 0) { Set-StepResult 'windows sdk' 'ok' ($sdks -join ', ') } else { Set-StepResult 'windows sdk' 'warn' 'Windows 10/11 SDK not found' }

Write-Step 'Blender'
$blender = $null
if ($env:IRONECHO_BLENDER -and (Test-Path $env:IRONECHO_BLENDER)) { $blender = $env:IRONECHO_BLENDER }
if (-not $blender) {
    $candidate = Get-ChildItem 'C:\Program Files\Blender Foundation\*\blender.exe' -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
    if ($candidate) { $blender = $candidate.FullName }
}
if (-not $blender) { $cmd = Get-Command blender -ErrorAction SilentlyContinue; if ($cmd) { $blender = $cmd.Source } }
$blenderVersion = $null
if ($blender) {
    $blenderVersion = (& $blender --version 2>$null | Select-Object -First 1)
    Set-StepResult 'blender' 'ok' "$blenderVersion at $blender"
} else {
    Set-StepResult 'blender' 'warn' 'not found (needed for ArtSource and Tools\Build\Bake-Realistic.ps1; not needed by the packaged game)'
}

Write-Step 'Python 3.12 (tracker development)'
$basePython = $null
$py = Get-Command py -ErrorAction SilentlyContinue
if ($py) { $basePython = (& $py.Source -3.12 -c "import sys; print(sys.executable)" 2>$null) }
if (-not $basePython) { $cmd = Get-Command python -ErrorAction SilentlyContinue; if ($cmd) { $basePython = $cmd.Source } }
$pyVersion = $null
if ($basePython) { $pyVersion = (& $basePython -c "import platform; print(platform.python_version())" 2>$null) }
if ($pyVersion -and $pyVersion -like '3.12*') { Set-StepResult 'python' 'ok' "$pyVersion at $basePython" }
elseif ($pyVersion) { Set-StepResult 'python' 'warn' "$pyVersion at $basePython (3.12 required by pinned numpy/mediapipe; install: winget install Python.Python.3.12)" }
else { Set-StepResult 'python' 'fail' 'Python 3.12 not found (winget install Python.Python.3.12)' }

Write-Step 'Git / LFS'
$gitVersion = (& git --version 2>$null)
$lfsVersion = (& git lfs version 2>$null)
if ($gitVersion) { Set-StepResult 'git' 'ok' $gitVersion } else { Set-StepResult 'git' 'fail' 'git not found' }
if ($lfsVersion) { Set-StepResult 'git lfs' 'ok' $lfsVersion } else { Set-StepResult 'git lfs' 'warn' 'git-lfs not found (needed for .uasset/.umap/.blend; winget install GitHub.GitLFS)' }

# ---------------------------------------------------------------- 3. local settings
Write-Step 'Local settings'
$cameraName = $null
if (@($hw.cameras).Count -gt 0) { $cameraName = @($hw.cameras)[0].name }
$local = [ordered]@{
    schema = 1
    generated = (Get-Date).ToString('s')
    note = 'Machine-local paths. Gitignored. Regenerate with Tools/Build/Bootstrap-Windows.ps1.'
    engine = $engineInfo
    visualStudio = $vsInfo
    blender = [ordered]@{ exe = $blender; version = $blenderVersion }
    python = [ordered]@{ exe = $basePython; version = $pyVersion }
    camera = [ordered]@{ index = 0; name = $cameraName }
}
Save-LocalSettings $local
Set-StepResult 'local settings' 'ok' $script:LocalSettingsPath

# ---------------------------------------------------------------- 4. tracker venv
$venvPython = Join-Path $script:ProjectRoot 'Tracking\.venv\Scripts\python.exe'
if ($basePython) {
    Write-Step 'Tracker virtual environment'
    if (-not (Test-Path $venvPython)) {
        $code = Invoke-Logged -Exe $basePython -ArgumentLine '-m venv Tracking\.venv' -LogFile "$bootDir\venv.log"
        if ($code -ne 0) { Set-StepResult 'venv' 'fail' "python -m venv failed ($code)" }
    }
    if (Test-Path $venvPython) {
        $code = Invoke-Logged -Exe $venvPython -ArgumentLine '-m pip install --disable-pip-version-check -r Tracking\requirements-dev.txt' -LogFile "$bootDir\pip.log"
        if ($code -eq 0) { Set-StepResult 'tracker deps' 'ok' 'requirements-dev.txt installed' } else { Set-StepResult 'tracker deps' 'fail' "pip failed ($code), see $bootDir\pip.log" }
        $code = Invoke-Logged -Exe $venvPython -ArgumentLine '-m iron_echo_tracker fetch-models' -LogFile "$bootDir\models.log" -WorkingDirectory (Join-Path $script:ProjectRoot 'Tracking')
        if ($code -eq 0) { Set-StepResult 'models' 'ok' 'pose_landmarker lite/full/heavy verified (sha256)' } else { Set-StepResult 'models' 'fail' "model download failed ($code)" }
        $code = Invoke-Logged -Exe $venvPython -ArgumentLine '-m iron_echo_tracker list-cameras' -LogFile "$bootDir\cameras.log" -WorkingDirectory (Join-Path $script:ProjectRoot 'Tracking')
        $camLine = (Get-Content "$bootDir\cameras.log" | Where-Object { $_ -like '`[*' } | Select-Object -Last 1)
        if ($code -eq 0) { Set-StepResult 'opencv cameras' 'ok' $camLine } else { Set-StepResult 'opencv cameras' 'warn' 'OpenCV could not open any camera (is it used by another app?)' }
    }
}

# ---------------------------------------------------------------- 5. tests
if (-not $SkipTests -and (Test-Path $venvPython)) {
    Write-Step 'Technical tests'
    & (Join-Path $PSScriptRoot 'Run-Tests.ps1')
    if ($LASTEXITCODE -eq 0) { Set-StepResult 'tests' 'ok' 'ownership + core rules + tracker' } else { Set-StepResult 'tests' 'fail' 'see Saved/Logs/Tests' }
}

# ---------------------------------------------------------------- 6. Unreal project
if ($engineInfo) {
    Write-Step 'Unreal project'
    $uproject = Get-Content -Raw $script:UProject | ConvertFrom-Json
    if ($engineInfo.source -eq 'launcher' -and $uproject.EngineAssociation -ne $engineInfo.majorMinor) {
        $text = Get-Content -Raw $script:UProject
        $text = $text -replace '"EngineAssociation":\s*"[^"]*"', ('"EngineAssociation": "' + $engineInfo.majorMinor + '"')
        [System.IO.File]::WriteAllText($script:UProject, $text, (New-Object System.Text.UTF8Encoding($false)))
        Set-StepResult 'engine association' 'warn' ("changed {0} -> {1} (commit this change)" -f $uproject.EngineAssociation, $engineInfo.majorMinor)
    } else {
        Set-StepResult 'engine association' 'ok' $uproject.EngineAssociation
    }
    if (-not $SkipUnrealBuild) {
        $buildBat = Join-Path $engineInfo.root 'Engine\Build\BatchFiles\Build.bat'
        $argLine = 'IronEchoEditor Win64 Development -Project=' + (Quote $script:UProject) + ' -WaitMutex -NoHotReloadFromIDE'
        $code = Invoke-Logged -Exe $buildBat -ArgumentLine $argLine -LogFile "$bootDir\build-editor.log"
        if ($code -eq 0) { Set-StepResult 'build IronEchoEditor' 'ok' 'Development Win64' } else { Set-StepResult 'build IronEchoEditor' 'fail' "exit $code, see $bootDir\build-editor.log" }
        if ($code -eq 0 -and -not $SkipProbe) {
            & (Join-Path $PSScriptRoot 'Run-UEProbe.ps1')
            if ($LASTEXITCODE -eq 0) { Set-StepResult 'editor python probe' 'ok' 'Saved/Probe/ue_probe_result.json' } else { Set-StepResult 'editor python probe' 'fail' "exit $LASTEXITCODE" }
        }
    }
}

# ---------------------------------------------------------------- 7. report
$report.finished = (Get-Date).ToString('s')
$report | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $bootDir 'bootstrap.json')
$md = New-Object System.Collections.Generic.List[string]
$md.Add("# Окружение Windows: отчёт bootstrap $($report.started)")
$md.Add('')
$md.Add('Сгенерировано `Tools/Build/Bootstrap-Windows.ps1`. Пути машины не включены.')
$md.Add('')
$md.Add('| Шаг | Статус | Детали |')
$md.Add('|---|---|---|')
foreach ($key in $report.steps.Keys) {
    $step = $report.steps[$key]
    $detail = ("$($step.detail)" -replace [regex]::Escape($env:USERPROFILE), '%USERPROFILE%') -replace '\|', '/'
    $md.Add("| $key | $($step.status) | $detail |")
}
$reportFile = Join-Path $script:ProjectRoot ("Docs\Reports\{0}_env_windows.md" -f (Get-Date).ToString('yyyy-MM-dd'))
[System.IO.File]::WriteAllLines($reportFile, $md, (New-Object System.Text.UTF8Encoding($false)))
Write-Step "Report: $reportFile"
$failed = @($report.steps.Keys | Where-Object { $report.steps[$_].status -eq 'fail' })
if ($failed.Count -gt 0) { Write-Fail ('blocking: ' + ($failed -join ', ')); exit 1 }
Write-Ok 'bootstrap complete'
