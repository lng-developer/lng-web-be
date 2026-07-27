const { execFileSync } = require('child_process');
const path = require('path');

const toolsFile = path.resolve(__dirname, '../../../../docs/hr/runbooks/hr-cutover-tools.ps1');

function runPowerShell(body) {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; . '${toolsFile}'; ${body}`], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

describe('HR cutover PowerShell tools', () => {
  test('accepts relative legacy commands only with three distinct exact PID bindings', () => {
    runPowerShell(`
      $processes = @(
        [pscustomobject]@{ ProcessId=11; Name='node.exe'; CommandLine='node server.js' },
        [pscustomobject]@{ ProcessId=12; Name='node.exe'; CommandLine='node cron-worker.js' },
        [pscustomobject]@{ ProcessId=13; Name='node.exe'; CommandLine='node sql-attendance-worker.js' }
      )
      $bindings = @(
        [pscustomobject]@{ processId=11; entrypoint='server.js' },
        [pscustomobject]@{ processId=12; entrypoint='cron-worker.js' },
        [pscustomobject]@{ processId=13; entrypoint='sql-attendance-worker.js' }
      )
      Assert-LegacyHrProcessBindings -Processes $processes -Bindings $bindings

      $missingBlocked=$false
      try { Assert-LegacyHrProcessBindings -Processes $processes -Bindings $bindings[0..1] } catch { $missingBlocked=$true }
      if (-not $missingBlocked) { exit 11 }

      $duplicate=@($bindings[0], [pscustomobject]@{processId=11;entrypoint='cron-worker.js'}, $bindings[2])
      $duplicateBlocked=$false
      try { Assert-LegacyHrProcessBindings -Processes $processes -Bindings $duplicate } catch { $duplicateBlocked=$true }
      if (-not $duplicateBlocked) { exit 12 }

      $wrong=@($bindings[0], [pscustomobject]@{processId=12;entrypoint='sql-attendance-worker.js'}, [pscustomobject]@{processId=13;entrypoint='cron-worker.js'})
      $wrongBlocked=$false
      try { Assert-LegacyHrProcessBindings -Processes $processes -Bindings $wrong } catch { $wrongBlocked=$true }
      if (-not $wrongBlocked) { exit 13 }
    `);
  });

  test('blocks unresolved dry-runs and replay reports that wrote rows', () => {
    runPowerShell(`
      $good = [pscustomobject]@{ mode='dry-run'; sourceDb='lng_hr'; targetDb='lng_web_be'; unresolvedCount=0; writeCount=0 }
      Assert-HrMigrationReport -Report $good -ExpectedMode 'dry-run' -ExpectedSourceDb 'lng_hr' -ExpectedTargetDb 'lng_web_be'
      $bad = [pscustomobject]@{ mode='dry-run'; sourceDb='lng_hr'; targetDb='lng_web_be'; unresolvedCount=1; writeCount=0 }
      $badBlocked = $false
      try { Assert-HrMigrationReport -Report $bad -ExpectedMode 'dry-run' -ExpectedSourceDb 'lng_hr' -ExpectedTargetDb 'lng_web_be' } catch { $badBlocked = $true }
      if (-not $badBlocked) { exit 21 }
      $replay = [pscustomobject]@{ mode='apply'; sourceDb='lng_hr'; targetDb='lng_web_be'; unresolvedCount=0; writeCount=1 }
      $replayBlocked = $false
      try { Assert-HrMigrationReport -Report $replay -ExpectedMode 'apply' -ExpectedSourceDb 'lng_hr' -ExpectedTargetDb 'lng_web_be' -RequireNoWrites } catch { $replayBlocked = $true }
      if (-not $replayBlocked) { exit 22 }
    `);
  });

  test('matches only the recorded node executable and exact worker script', () => {
    runPowerShell(`
      $record = [pscustomobject]@{ nodeExecutable='C:\\Program Files\\nodejs\\node.exe'; scriptPath='C:\\pod\\sqlAttendance.worker.js' }
      $process = [pscustomobject]@{ Name='node.exe'; ExecutablePath='C:\\Program Files\\nodejs\\node.exe'; CommandLine='"C:\\Program Files\\nodejs\\node.exe" "C:\\pod\\sqlAttendance.worker.js"' }
      if (-not (Test-ExactNodeWorkerProcess -Process $process -Record $record)) { exit 31 }
      $process.CommandLine='"C:\\Program Files\\nodejs\\node.exe" "C:\\other\\sqlAttendance.worker.js"'
      if (Test-ExactNodeWorkerProcess -Process $process -Record $record) { exit 32 }
    `);
  });

  test('persists empty and partial worker evidence as valid atomic JSON', () => {
    runPowerShell(`
      $dir = Join-Path ([System.IO.Path]::GetTempPath()) "hr-worker-evidence-$PID"
      New-Item -ItemType Directory -Force $dir | Out-Null
      $file = Join-Path $dir 'workers.json'
      Write-HrWorkerEvidenceAtomically -EvidenceFile $file -Records @()
      if ((Get-Content -Raw $file).Trim() -ne '[]') { exit 41 }
      $records = @([pscustomobject]@{processId=51;nodeExecutable='C:\\node.exe';scriptPath='C:\\pod\\sqlAttendance.worker.js'})
      Write-HrWorkerEvidenceAtomically -EvidenceFile $file -Records $records
      $saved = @(Get-Content -Raw $file | ConvertFrom-Json)
      if ($saved.Count -ne 1 -or $saved[0].processId -ne 51) { exit 42 }
      Remove-Item -LiteralPath $dir -Recurse -Force
    `);
  });

  test('partial recovery skips a dead first PID and finds a live second worker plus duplicates', () => {
    runPowerShell(`
      $definitions = @(
        [pscustomobject]@{nodeExecutable='C:\\node.exe';scriptPath='C:\\pod\\sqlAttendance.worker.js'},
        [pscustomobject]@{nodeExecutable='C:\\node.exe';scriptPath='C:\\pod\\announcement.worker.js'}
      )
      $processes = @(
        [pscustomobject]@{ProcessId=62;Name='node.exe';ExecutablePath='C:\\node.exe';CommandLine='node C:\\pod\\announcement.worker.js'},
        [pscustomobject]@{ProcessId=63;Name='node.exe';ExecutablePath='C:\\node.exe';CommandLine='node C:\\pod\\announcement.worker.js'},
        [pscustomobject]@{ProcessId=64;Name='node.exe';ExecutablePath='C:\\node.exe';CommandLine='node C:\\other\\sqlAttendance.worker.js'}
      )
      $matches = @(Get-ExactNodeWorkerProcesses -Processes $processes -WorkerDefinitions $definitions)
      if (($matches.ProcessId | Sort-Object) -join ',' -ne '62,63') { exit 51 }
    `);
  });
});
