function Test-LegacyHrProcess {
  param(
    [Parameter(Mandatory)]$Process,
    [Parameter(Mandatory)][string]$LegacyRoot,
    [Parameter(Mandatory)][string[]]$EntryNames
  )

  if ($Process.Name -ne 'node.exe' -or $Process.CommandLine -notlike "*$LegacyRoot*") { return $false }
  foreach ($entryName in $EntryNames) {
    if ($Process.CommandLine -like "*$entryName*") { return $true }
  }
  return $false
}

function Assert-HrMigrationReport {
  param(
    [Parameter(Mandatory)]$Report,
    [Parameter(Mandatory)][ValidateSet('dry-run', 'apply')][string]$ExpectedMode,
    [Parameter(Mandatory)][string]$ExpectedSourceDb,
    [Parameter(Mandatory)][string]$ExpectedTargetDb,
    [switch]$RequireNoWrites
  )

  if ($Report.mode -ne $ExpectedMode) { throw "STOP: expected migration mode $ExpectedMode" }
  if ($Report.sourceDb -ne $ExpectedSourceDb -or $Report.targetDb -ne $ExpectedTargetDb) {
    throw 'STOP: migration report has unexpected database targets'
  }
  if ($Report.sourceDb -eq $Report.targetDb) { throw 'STOP: source and target databases are identical' }
  if ([int64]$Report.unresolvedCount -ne 0) { throw "STOP: migration has $($Report.unresolvedCount) unresolved rows" }
  if ($RequireNoWrites -and [int64]$Report.writeCount -ne 0) {
    throw "STOP: migration replay wrote $($Report.writeCount) rows"
  }
}

function Test-ExactNodeWorkerProcess {
  param(
    [Parameter(Mandatory)]$Process,
    [Parameter(Mandatory)]$Record
  )

  if ($Process.Name -ne 'node.exe') { return $false }
  if ([string]::Compare([string]$Process.ExecutablePath, [string]$Record.nodeExecutable, $true) -ne 0) { return $false }
  $scriptPattern = [regex]::Escape([string]$Record.scriptPath)
  return [string]$Process.CommandLine -match ('(?i)(^|[\s"])' + $scriptPattern + '([\s"]|$)')
}
