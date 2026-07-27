function Test-CommandHasScriptArgument {
  param(
    [Parameter(Mandatory)][string]$CommandLine,
    [Parameter(Mandatory)][string]$ScriptBasename
  )

  $scriptPattern = [regex]::Escape($ScriptBasename)
  return $CommandLine -match ('(?i)(^|[\s"])(?:[^\s"]*[\\/])?' + $scriptPattern + '([\s"]|$)')
}

function Assert-LegacyHrProcessBindings {
  param(
    [Parameter(Mandatory)][object[]]$Processes,
    [Parameter(Mandatory)][object[]]$Bindings
  )

  $expectedEntrypoints = @('server.js', 'cron-worker.js', 'sql-attendance-worker.js')
  if ($Bindings.Count -ne $expectedEntrypoints.Count) { throw 'STOP: exactly three legacy PID bindings are required' }
  if (@($Bindings.processId | Sort-Object -Unique).Count -ne $expectedEntrypoints.Count) { throw 'STOP: legacy PIDs must be distinct' }
  if (@($Bindings.entrypoint | Sort-Object -Unique).Count -ne $expectedEntrypoints.Count) { throw 'STOP: each legacy entrypoint must be bound once' }

  foreach ($entrypoint in $expectedEntrypoints) {
    $binding = @($Bindings | Where-Object { $_.entrypoint -eq $entrypoint })
    if ($binding.Count -ne 1) { throw "STOP: missing legacy PID binding for $entrypoint" }
    $process = @($Processes | Where-Object { $_.ProcessId -eq $binding[0].processId })
    if ($process.Count -ne 1 -or $process[0].Name -ne 'node.exe') { throw "STOP: PID $($binding[0].processId) is not one Node process" }
    if (-not (Test-CommandHasScriptArgument -CommandLine $process[0].CommandLine -ScriptBasename $entrypoint)) {
      throw "STOP: PID $($binding[0].processId) does not run $entrypoint"
    }
  }
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

function Write-HrWorkerEvidenceAtomically {
  param(
    [Parameter(Mandatory)][string]$EvidenceFile,
    [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Records
  )

  $directory = Split-Path -Parent $EvidenceFile
  if (-not (Test-Path -LiteralPath $directory)) { throw 'STOP: worker evidence directory is missing' }
  $temporaryFile = Join-Path $directory ".$([System.IO.Path]::GetFileName($EvidenceFile)).$PID.$([guid]::NewGuid().ToString('N')).tmp"
  $backupFile = "$EvidenceFile.replace-backup"
  try {
    $json = ConvertTo-Json -InputObject @($Records) -Depth 6 -Compress
    [System.IO.File]::WriteAllText($temporaryFile, $json, [System.Text.UTF8Encoding]::new($false))
    if (Test-Path -LiteralPath $EvidenceFile) {
      [System.IO.File]::Replace($temporaryFile, $EvidenceFile, $backupFile)
      if (Test-Path -LiteralPath $backupFile) { Remove-Item -LiteralPath $backupFile -Force }
    } else {
      [System.IO.File]::Move($temporaryFile, $EvidenceFile)
    }
  } finally {
    if (Test-Path -LiteralPath $temporaryFile) { Remove-Item -LiteralPath $temporaryFile -Force }
  }
}

function Get-ExactNodeWorkerProcesses {
  param(
    [Parameter(Mandatory)][object[]]$Processes,
    [Parameter(Mandatory)][object[]]$WorkerDefinitions
  )

  $seen = @{}
  foreach ($process in $Processes) {
    foreach ($definition in $WorkerDefinitions) {
      if (-not $seen.ContainsKey([string]$process.ProcessId) -and (Test-ExactNodeWorkerProcess -Process $process -Record $definition)) {
        $seen[[string]$process.ProcessId] = $true
        $process
        break
      }
    }
  }
}
