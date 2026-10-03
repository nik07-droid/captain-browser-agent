param(
  [Parameter(Mandatory = $true)][string]$ExpectedEntry,
  [Parameter(Mandatory = $true)][string]$ExpectedNode,
  [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port
)
$ErrorActionPreference = 'Stop'
$entryPath = (Resolve-Path -LiteralPath $ExpectedEntry).Path
$nodePath = (Resolve-Path -LiteralPath $ExpectedNode).Path
if ([System.IO.Path]::GetFileName($entryPath) -ne 'index.mjs' -or [System.IO.Path]::GetFileName([System.IO.Path]::GetDirectoryName($entryPath)) -ne 'server') {
  throw 'Expected entry must be the exact CAPTAIN server/index.mjs file.'
}
$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -eq 0) { @{ stopped = $false; reason = 'already stopped' } | ConvertTo-Json -Compress; exit 0 }
if (@($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') }).Count -gt 0) { throw 'Refusing to stop a non-loopback listener.' }
$processIds = @($listeners.OwningProcess | Select-Object -Unique)
if ($processIds.Count -ne 1) { throw 'Refusing ambiguous port ownership.' }
$serverProcessId = [int]$processIds[0]
$serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $serverProcessId"
# Only our launcher's exact node + absolute entry command is accepted. No
# substring project matching, relative paths, --eval, watch supervisors, or
# arbitrary node processes may be terminated by this helper.
$nodeToken = '(?:"' + [regex]::Escape($nodePath) + '"|' + [regex]::Escape($nodePath) + ')'
$entryToken = '(?:"' + [regex]::Escape($entryPath) + '"|' + [regex]::Escape($entryPath) + ')'
$expectedCommand = '^\s*' + $nodeToken + '\s+' + $entryToken + '\s*$'
if (-not $serverProcess -or $serverProcess.ExecutablePath -ine $nodePath -or $serverProcess.CommandLine -inotmatch $expectedCommand) {
  throw 'The listener is not the exact CAPTAIN server launched by this project.'
}
$processHandle = [System.Diagnostics.Process]::GetProcessById($serverProcessId)
try {
  # Pin this process handle before the final identity check, so a reused PID
  # cannot cause Stop-Process to target a replacement process.
  $null = $processHandle.Handle
  $verifiedProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $serverProcessId"
  if (-not $verifiedProcess -or $verifiedProcess.CreationDate -ne $serverProcess.CreationDate -or $verifiedProcess.CommandLine -cne $serverProcess.CommandLine) {
    throw 'Process identity changed during verification; nothing was stopped.'
  }
  Stop-Process -InputObject $processHandle -ErrorAction Stop
  if (-not $processHandle.WaitForExit(5000)) { throw 'Verified CAPTAIN process has not exited yet; a replacement was not started.' }
} finally {
  $processHandle.Dispose()
}
@{ stopped = $true; processId = $serverProcessId } | ConvertTo-Json -Compress
