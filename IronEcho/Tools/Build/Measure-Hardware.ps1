<#
.SYNOPSIS
  Measures the real machine (OS, CPU, RAM, GPU + VRAM, cameras, displays) and writes JSON + Markdown.
  VRAM is read from nvidia-smi when present, else from the display adapter registry (64-bit value);
  WMI AdapterRAM is NOT used for the result because it saturates at 4 GB.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File Tools\Build\Measure-Hardware.ps1
#>
param([string]$OutDir)

. (Join-Path $PSScriptRoot 'Common.ps1')
if (-not $OutDir) { $OutDir = Join-Path $script:SavedDir 'Bootstrap' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Get-Hardware {
    $os = Get-CimInstance Win32_OperatingSystem
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $cs = Get-CimInstance Win32_ComputerSystem

    $gpus = @()
    $smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if ($smi) {
        $rows = & $smi.Source --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits 2>$null
        foreach ($row in $rows) {
            $parts = $row -split ','
            if ($parts.Count -ge 3) {
                $gpus += [ordered]@{ name = $parts[0].Trim(); vram_mib = [int]$parts[1].Trim(); driver = $parts[2].Trim(); source = 'nvidia-smi' }
            }
        }
    }
    if ($gpus.Count -eq 0) {
        $classKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'
        Get-ChildItem $classKey -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match '^\d{4}$' } | ForEach-Object {
            $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
            if ($props -and $props.DriverDesc) {
                $bytes = $null
                if ($props.PSObject.Properties.Name -contains 'HardwareInformation.qwMemorySize') {
                    $raw = $props.'HardwareInformation.qwMemorySize'
                    if ($raw -is [byte[]]) { $bytes = [BitConverter]::ToInt64($raw, 0) } else { $bytes = [int64]$raw }
                }
                $vram = $null
                if ($bytes) { $vram = [int]($bytes / 1MB) }
                $gpus += [ordered]@{ name = $props.DriverDesc; vram_mib = $vram; driver = $props.DriverVersion; source = 'registry' }
            }
        }
    }

    $cameras = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.Class -in @('Camera', 'Image') } |
        ForEach-Object { [ordered]@{ name = $_.FriendlyName; status = "$($_.Status)"; class = $_.Class } })

    $displays = @(Get-CimInstance Win32_VideoController | ForEach-Object {
        [ordered]@{ adapter = $_.Name; resolution = "$($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution)"; refresh_hz = $_.CurrentRefreshRate }
    })

    return [ordered]@{
        measured_utc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        os = "$($os.Caption) $($os.Version) build $($os.BuildNumber) $($os.OSArchitecture)"
        cpu = "$($cpu.Name.Trim()) ($($cpu.NumberOfCores)C/$($cpu.NumberOfLogicalProcessors)T)"
        ram_gib = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
        gpus = $gpus
        displays = $displays
        cameras = $cameras
    }
}

$hw = Get-Hardware
$jsonPath = Join-Path $OutDir 'hardware.json'
$hw | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 -Path $jsonPath
Write-Host ($hw | ConvertTo-Json -Depth 6)
Write-Ok "hardware written to $jsonPath"
