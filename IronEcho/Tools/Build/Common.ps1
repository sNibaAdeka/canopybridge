# Shared helpers for IRON ECHO Windows scripts. Windows PowerShell 5.1 compatible.
# Machine-specific paths come from Tools/local.settings.json (written by Bootstrap-Windows.ps1, gitignored)
# or from environment variables IRONECHO_UE_ROOT / IRONECHO_BLENDER / IRONECHO_PYTHON. Nothing is hard-coded.

# Strict mode 1.0: catches misspelled variables; property probing on registry/WMI objects stays tolerant.
Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Stop'

$script:ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:UProject = Join-Path $script:ProjectRoot 'IronEcho.uproject'
$script:LocalSettingsPath = Join-Path $script:ProjectRoot 'Tools\local.settings.json'
$script:SavedDir = Join-Path $script:ProjectRoot 'Saved'

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host ('==> ' + $Message) -ForegroundColor Cyan
}

function Write-Ok([string]$Message) { Write-Host ('    OK   ' + $Message) -ForegroundColor Green }
function Write-Warn2([string]$Message) { Write-Host ('    WARN ' + $Message) -ForegroundColor Yellow }
function Write-Fail([string]$Message) { Write-Host ('    FAIL ' + $Message) -ForegroundColor Red }

function Get-LocalSettings {
    if (-not (Test-Path $script:LocalSettingsPath)) {
        throw "Tools/local.settings.json not found. Run Tools/Build/Bootstrap-Windows.ps1 first."
    }
    return (Get-Content -Raw -Path $script:LocalSettingsPath | ConvertFrom-Json)
}

function Save-LocalSettings($Settings) {
    $json = $Settings | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText($script:LocalSettingsPath, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-EngineRoot {
    if ($env:IRONECHO_UE_ROOT) { return $env:IRONECHO_UE_ROOT }
    $settings = Get-LocalSettings
    if (-not $settings.engine -or -not $settings.engine.root) { throw 'Unreal Engine root unknown (local settings / IRONECHO_UE_ROOT).' }
    return $settings.engine.root
}

function Get-EditorCmd {
    $exe = Join-Path (Get-EngineRoot) 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
    if (-not (Test-Path $exe)) { throw "UnrealEditor-Cmd.exe not found: $exe" }
    return $exe
}

function Get-TrackerPython {
    if ($env:IRONECHO_PYTHON) { return $env:IRONECHO_PYTHON }
    $venv = Join-Path $script:ProjectRoot 'Tracking\.venv\Scripts\python.exe'
    if (Test-Path $venv) { return $venv }
    throw 'Tracker venv missing. Run Tools/Build/Bootstrap-Windows.ps1.'
}

function New-Timestamp { return (Get-Date).ToString('yyyyMMdd-HHmmss') }

function Quote([string]$Value) { return '"' + $Value + '"' }

function Invoke-Logged {
    # Runs a program with an exact argument line (no PowerShell re-quoting, so -ExecCmds="a; b" survives),
    # tails its output to the console, keeps stdout+stderr in LogFile and returns the exit code.
    param([string]$Exe, [string]$ArgumentLine = '', [string]$LogFile, [string]$WorkingDirectory = $script:ProjectRoot)
    $dir = Split-Path -Parent $LogFile
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $errFile = $LogFile + '.stderr'
    Set-Content -Path $LogFile -Value '' -Encoding UTF8
    $startArgs = @{ FilePath = $Exe; WorkingDirectory = $WorkingDirectory; RedirectStandardOutput = $LogFile; RedirectStandardError = $errFile; NoNewWindow = $true; PassThru = $true }
    if ($ArgumentLine) { $startArgs.ArgumentList = $ArgumentLine }
    $process = Start-Process @startArgs
    $null = $process.Handle  # makes ExitCode available after exit (PowerShell 5.1 quirk)
    $shown = 0
    while (-not $process.HasExited) {
        Start-Sleep -Milliseconds 500
        $lines = @(Get-Content -Path $LogFile -ErrorAction SilentlyContinue)
        if ($lines.Count -gt $shown) { $lines[$shown..($lines.Count - 1)] | ForEach-Object { Write-Host "    $_" }; $shown = $lines.Count }
    }
    $process.WaitForExit()
    $lines = @(Get-Content -Path $LogFile -ErrorAction SilentlyContinue)
    if ($lines.Count -gt $shown) { $lines[$shown..($lines.Count - 1)] | ForEach-Object { Write-Host "    $_" } }
    if (Test-Path $errFile) {
        $err = Get-Content -Path $errFile -ErrorAction SilentlyContinue
        if ($err) { Add-Content -Path $LogFile -Value $err; $err | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkYellow } }
        Remove-Item $errFile -ErrorAction SilentlyContinue
    }
    return [int]$process.ExitCode
}

function Find-VsWhere {
    $path = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path $path) { return $path }
    return $null
}

function Find-CMake {
    $cmd = Get-Command cmake -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $vswhere = Find-VsWhere
    if ($vswhere) {
        $found = & $vswhere -latest -products * -find 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe' 2>$null | Select-Object -First 1
        if ($found) { return $found }
    }
    return $null
}
