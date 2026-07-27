function Test-CommandHasScriptArgument {
  param(
    [Parameter(Mandatory)][string]$CommandLine,
    [Parameter(Mandatory)][string]$ScriptBasename
  )

  $scriptPattern = [regex]::Escape($ScriptBasename)
  return $CommandLine -match ('(?i)(^|[\s"])(?:[^\s"]*[\\/])?' + $scriptPattern + '([\s"]|$)')
}

function ConvertTo-SafePm2AppState {
  param(
    [Parameter(Mandatory)][object[]]$Pm2Apps,
    [Parameter(Mandatory)][string[]]$RequiredAppNames
  )

  foreach ($app in $Pm2Apps) {
    if ($app.name -notin $RequiredAppNames) { continue }
    [pscustomobject][ordered]@{
      name = [string]$app.name
      pmId = [int]$app.pm_id
      pid = [int]$app.pid
      status = [string]$app.pm2_env.status
      restartCount = [int64]$app.pm2_env.restart_time
    }
  }
}

function ConvertFrom-Pm2JlistSafeState {
  param(
    [Parameter(Mandatory)][string]$JlistJson,
    [Parameter(Mandatory)][string[]]$RequiredAppNames
  )

  $decoded = $JlistJson | ConvertFrom-Json
  $apps = @($decoded | ForEach-Object { $_ })
  ConvertTo-SafePm2AppState -Pm2Apps $apps -RequiredAppNames $RequiredAppNames
}

function Assert-LegacyHrPm2AppsStopped {
  param(
    [Parameter(Mandatory)][object[]]$Before,
    [Parameter(Mandatory)][object[]]$After,
    [Parameter(Mandatory)][string[]]$RequiredAppNames
  )

  foreach ($appName in $RequiredAppNames) {
    $beforeReplicas = @($Before | Where-Object { $_.name -eq $appName })
    $afterReplicas = @($After | Where-Object { $_.name -eq $appName })
    if ($beforeReplicas.Count -eq 0) { throw "STOP: required PM2 app $appName was missing before freeze" }
    if ($afterReplicas.Count -ne $beforeReplicas.Count) { throw "STOP: PM2 replica count changed for $appName" }

    $beforePmIds = @($beforeReplicas.pmId | Sort-Object -Unique)
    $afterPmIds = @($afterReplicas.pmId | Sort-Object -Unique)
    if ($beforePmIds.Count -ne $beforeReplicas.Count -or $afterPmIds.Count -ne $afterReplicas.Count) {
      throw "STOP: PM2 replica IDs are not unique for $appName"
    }
    if (Compare-Object -ReferenceObject $beforePmIds -DifferenceObject $afterPmIds) {
      throw "STOP: PM2 replica identity changed for $appName"
    }
    if ($afterReplicas | Where-Object { $_.status -ne 'stopped' -or [int]$_.pid -ne 0 }) {
      throw "STOP: PM2 app $appName still has an active or restarted replica"
    }
  }
}

function Get-LegacySqlAttendanceProcesses {
  param([Parameter(Mandatory)][object[]]$Processes)

  $Processes | Where-Object {
    $_.Name -eq 'node.exe' -and
    (Test-CommandHasScriptArgument -CommandLine ([string]$_.CommandLine) -ScriptBasename 'sql-attendance-worker.js')
  }
}

function Assert-LegacySqlAttendanceProcessBinding {
  param(
    [Parameter(Mandatory)][object[]]$Processes,
    [Parameter(Mandatory)][int]$ProcessId
  )

  if ($ProcessId -le 0) { throw 'STOP: a positive SQL attendance worker PID is required' }
  $process = @($Processes | Where-Object { $_.ProcessId -eq $ProcessId })
  if ($process.Count -ne 1 -or $process[0].Name -ne 'node.exe') {
    throw "STOP: PID $ProcessId is not one Node process"
  }
  if (-not (Test-CommandHasScriptArgument -CommandLine ([string]$process[0].CommandLine) -ScriptBasename 'sql-attendance-worker.js')) {
    throw "STOP: PID $ProcessId does not run sql-attendance-worker.js"
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
