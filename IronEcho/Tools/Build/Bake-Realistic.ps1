<#
.SYNOPSIS
  Builds the realistic IE-1 robots for the game: Blender bakes the procedural materials (paint, scratches, chips,
  dust, grime) into 4K BaseColor/Normal/ORM/Emissive textures and exports SK_IE1_Forge/Ember.fbx into
  ArtSource/Realistic/Export; with -Import the editor then imports them into /Game/Tech/Realistic with the PBR
  material, contract sockets and DA_IronEchoVisuals_Realistic.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File Tools\Build\Bake-Realistic.ps1 -Import
#>
param([switch]$Import, [int]$Resolution = 4096, [string]$Livery = 'Forge,Ember')

. (Join-Path $PSScriptRoot 'Common.ps1')

function Find-Blender {
    if ($env:IRONECHO_BLENDER -and (Test-Path $env:IRONECHO_BLENDER)) { return $env:IRONECHO_BLENDER }
    $candidate = Get-ChildItem 'C:\Program Files\Blender Foundation\*\blender.exe' -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
    $cmd = Get-Command blender -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

$stamp = New-Timestamp
$logs = Join-Path $script:SavedDir "Logs\Bake\$stamp"
$blender = Find-Blender
if (-not $blender) { Write-Fail 'Blender 4.5 LTS not found (winget install BlenderFoundation.Blender.LTS.4.5 or set IRONECHO_BLENDER)'; exit 1 }

Write-Step "Bake realistic robots ($blender)"
$script = Join-Path $script:ProjectRoot 'Tools\Blender\Realistic\bake_robot.py'
$out = Join-Path $script:ProjectRoot 'ArtSource\Realistic\Export'
$argLine = '-b --factory-startup -P ' + (Quote $script) + ' -- --out ' + (Quote $out) + " --res $Resolution --livery $Livery"
if ((Invoke-Logged -Exe $blender -ArgumentLine $argLine -LogFile "$logs\bake.log") -ne 0) { Write-Fail "bake failed; log: $logs\bake.log"; exit 1 }
Write-Ok "textures + FBX in $out (check bake_check_*.png and bake_report.json)"

if ($Import) {
    Write-Step 'Import into Unreal (/Game/Tech/Realistic)'
    $importScript = Join-Path $script:ProjectRoot 'Tools\Unreal\Tech\import_realistic_robot.py'
    $ueArgs = (Quote $script:UProject) + ' -run=pythonscript -script=' + (Quote $importScript) + ' -unattended -nop4 -nosplash -stdout -FullStdOutLogOutput'
    if ((Invoke-Logged -Exe (Get-EditorCmd) -ArgumentLine $ueArgs -LogFile "$logs\ue-import.log") -ne 0) { Write-Fail "import failed; log: $logs\ue-import.log"; exit 1 }
    Write-Ok 'imported; next: Tools\Unreal\Tech\validate_robot.py, then Codex''s Tools\Unreal\Art\prepare_contract_camera.py (wires robots + camera into DA_IronEchoVisuals)'
}
