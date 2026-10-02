<#
.SYNOPSIS
  Rebuilds the IronEchoEditor target (after C++ changes). Close the editor first, or use Live Coding inside it.
#>
param([ValidateSet('Development', 'DebugGame')][string]$Config = 'Development')

. (Join-Path $PSScriptRoot 'Common.ps1')
$buildBat = Join-Path (Get-EngineRoot) 'Engine\Build\BatchFiles\Build.bat'
$log = Join-Path $script:SavedDir ("Logs\Build\editor_{0}.log" -f (New-Timestamp))
Write-Step "Build IronEchoEditor Win64 $Config"
$code = Invoke-Logged -Exe $buildBat -ArgumentLine ('IronEchoEditor Win64 ' + $Config + ' -Project=' + (Quote $script:UProject) + ' -WaitMutex -NoHotReloadFromIDE') -LogFile $log
if ($code -ne 0) { Write-Fail "build failed ($code), log: $log"; exit $code }
Write-Ok "build ok, log: $log"
