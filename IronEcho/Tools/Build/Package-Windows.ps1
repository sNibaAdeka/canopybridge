<#
.SYNOPSIS
  Builds the player package: game (UAT BuildCookRun) + standalone tracker (PyInstaller), then smoke-tests it.
  The result runs without Python, Blender or the Unreal Editor on the player's PC.

  Layout:  Build\Package\Windows\IronEcho.exe
           Build\Package\Windows\IronEcho\Tracker\IronEchoTracker.exe   (+ _internal\, models inside)

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File Tools\Build\Package-Windows.ps1                 # Shipping
  powershell -ExecutionPolicy Bypass -File Tools\Build\Package-Windows.ps1 -Config Development
#>
param(
    [ValidateSet('Shipping', 'Development')][string]$Config = 'Shipping',
    [switch]$SkipGame,
    [switch]$SkipTracker
)

. (Join-Path $PSScriptRoot 'Common.ps1')
$stamp = New-Timestamp
$logs = Join-Path $script:SavedDir "Logs\Package\$stamp"
$packageRoot = Join-Path $script:ProjectRoot 'Build\Package'
$trackerBuild = Join-Path $script:ProjectRoot 'Build\Tracker'
$trackerDist = Join-Path $trackerBuild 'dist\IronEchoTracker'

if (-not $SkipTracker) {
    Write-Step 'Tracker bundle (PyInstaller)'
    $python = Get-TrackerPython
    $tracking = Join-Path $script:ProjectRoot 'Tracking'
    if ((Invoke-Logged -Exe $python -ArgumentLine '-m iron_echo_tracker fetch-models --name full' -LogFile "$logs\models.log" -WorkingDirectory $tracking) -ne 0) { Write-Fail 'models'; exit 1 }
    if ((Invoke-Logged -Exe $python -ArgumentLine '-m iron_echo_tracker fetch-models --name lite' -LogFile "$logs\models-lite.log" -WorkingDirectory $tracking) -ne 0) { Write-Fail 'models'; exit 1 }
    $argLine = '-m PyInstaller --noconfirm --clean --distpath ' + (Quote (Join-Path $trackerBuild 'dist')) + ' --workpath ' + (Quote (Join-Path $trackerBuild 'work')) + ' IronEchoTracker.spec'
    if ((Invoke-Logged -Exe $python -ArgumentLine $argLine -LogFile "$logs\pyinstaller.log" -WorkingDirectory $tracking) -ne 0) { Write-Fail "PyInstaller failed, see $logs"; exit 1 }
    $trackerExe = Join-Path $trackerDist 'IronEchoTracker.exe'
    # Smoke test with a clean environment: no venv on PATH, no PYTHONPATH.
    $savedPath = $env:PATH; $savedPyPath = $env:PYTHONPATH
    $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"; $env:PYTHONPATH = ''
    $code = Invoke-Logged -Exe $trackerExe -ArgumentLine 'selftest' -LogFile "$logs\tracker-selftest.log" -WorkingDirectory $trackerDist
    $env:PATH = $savedPath; $env:PYTHONPATH = $savedPyPath
    if ($code -ne 0) { Write-Fail "packaged tracker selftest failed, see $logs"; exit 1 }
    $size = [math]::Round(((Get-ChildItem $trackerDist -Recurse | Measure-Object Length -Sum).Sum / 1MB), 1)
    Write-Ok "tracker bundle ok ($size MiB)"
}

if (-not $SkipGame) {
    Write-Step "Game package ($Config)"
    $uat = Join-Path (Get-EngineRoot) 'Engine\Build\BatchFiles\RunUAT.bat'
    $argLine = 'BuildCookRun -project=' + (Quote $script:UProject) + ' -noP4 -platform=Win64 -clientconfig=' + $Config +
        ' -build -cook -stage -pak -iostore -package -archive -archivedirectory=' + (Quote $packageRoot) + ' -prereqs -utf8output -nodebuginfo'
    if ((Invoke-Logged -Exe $uat -ArgumentLine $argLine -LogFile "$logs\uat.log") -ne 0) { Write-Fail "UAT failed, see $logs\uat.log"; exit 1 }
}

$gameDir = Join-Path $packageRoot 'Windows\IronEcho'
if (Test-Path $gameDir) {
    Write-Step 'Stage tracker into the package'
    $target = Join-Path $gameDir 'Tracker'
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    Copy-Item -Recurse $trackerDist $target
    $notice = Join-Path $target 'THIRD_PARTY_NOTICES.txt'
    Set-Content -Encoding UTF8 -Path $notice -Value @(
        'IRON ECHO tracker bundles: Python runtime (PSF License), MediaPipe and pose_landmarker models (Apache-2.0),',
        'OpenCV (Apache-2.0), NumPy (BSD-3-Clause), Matplotlib (PSF-based), absl-py (Apache-2.0), flatbuffers (Apache-2.0).',
        'Full license texts: see Docs/Legal (to be completed before any public release).')
    Write-Ok "tracker staged at $target"
    $total = [math]::Round(((Get-ChildItem (Join-Path $packageRoot 'Windows') -Recurse | Measure-Object Length -Sum).Sum / 1GB), 2)
    Write-Ok "package size $total GiB at $(Join-Path $packageRoot 'Windows')"
} else {
    Write-Warn2 "game package folder not found ($gameDir); tracker not staged"
}
