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
  test('blocks when PM2 replaces an old writer PID with a new online PID', () => {
    runPowerShell(`
      Get-Command Assert-LegacyHrPm2AppsStopped -ErrorAction Stop | Out-Null
      $before = @(
        [pscustomobject]@{name='lng-hr-be';pmId=0;pid=101;status='online'},
        [pscustomobject]@{name='lng-hr-cron';pmId=1;pid=102;status='online'}
      )
      $after = @(
        [pscustomobject]@{name='lng-hr-be';pmId=0;pid=201;status='online'},
        [pscustomobject]@{name='lng-hr-cron';pmId=1;pid=0;status='stopped'}
      )
      $blocked = $false
      try { Assert-LegacyHrPm2AppsStopped -Before $before -After $after -RequiredAppNames @('lng-hr-be','lng-hr-cron') } catch { $blocked = $true }
      if (-not $blocked) { exit 6 }
    `);
  });

  test('accepts all captured PM2 writer replicas only when each is stopped', () => {
    runPowerShell(`
      Get-Command Assert-LegacyHrPm2AppsStopped -ErrorAction Stop | Out-Null
      $before = @(
        [pscustomobject]@{name='lng-hr-be';pmId=0;pid=101;status='online'},
        [pscustomobject]@{name='lng-hr-be';pmId=2;pid=103;status='online'},
        [pscustomobject]@{name='lng-hr-cron';pmId=1;pid=102;status='online'}
      )
      $after = @(
        [pscustomobject]@{name='lng-hr-be';pmId=0;pid=0;status='stopped'},
        [pscustomobject]@{name='lng-hr-be';pmId=2;pid=0;status='stopped'},
        [pscustomobject]@{name='lng-hr-cron';pmId=1;pid=0;status='stopped'}
      )
      Assert-LegacyHrPm2AppsStopped -Before $before -After $after -RequiredAppNames @('lng-hr-be','lng-hr-cron')
    `);
  });

  test('blocks when a required PM2 app or a captured replica is missing', () => {
    runPowerShell(`
      Get-Command Assert-LegacyHrPm2AppsStopped -ErrorAction Stop | Out-Null
      $before = @(
        [pscustomobject]@{name='lng-hr-be';pmId=0;pid=101;status='online'},
        [pscustomobject]@{name='lng-hr-be';pmId=2;pid=103;status='online'},
        [pscustomobject]@{name='lng-hr-cron';pmId=1;pid=102;status='online'}
      )
      $missingReplica = @(
        [pscustomobject]@{name='lng-hr-be';pmId=0;pid=0;status='stopped'},
        [pscustomobject]@{name='lng-hr-cron';pmId=1;pid=0;status='stopped'}
      )
      $replicaBlocked = $false
      try { Assert-LegacyHrPm2AppsStopped -Before $before -After $missingReplica -RequiredAppNames @('lng-hr-be','lng-hr-cron') } catch { $replicaBlocked = $true }
      if (-not $replicaBlocked) { exit 7 }

      $missingAppAfter = @(
        [pscustomobject]@{name='lng-hr-be';pmId=0;pid=0;status='stopped'},
        [pscustomobject]@{name='lng-hr-be';pmId=2;pid=0;status='stopped'}
      )
      $missingAfterBlocked = $false
      try { Assert-LegacyHrPm2AppsStopped -Before $before -After $missingAppAfter -RequiredAppNames @('lng-hr-be','lng-hr-cron') } catch { $missingAfterBlocked = $true }
      if (-not $missingAfterBlocked) { exit 8 }

      $missingAppBefore = @([pscustomobject]@{name='lng-hr-be';pmId=0;pid=101;status='online'})
      $onlyAppAfter = @([pscustomobject]@{name='lng-hr-be';pmId=0;pid=0;status='stopped'})
      $appBlocked = $false
      try { Assert-LegacyHrPm2AppsStopped -Before $missingAppBefore -After $onlyAppAfter -RequiredAppNames @('lng-hr-be','lng-hr-cron') } catch { $appBlocked = $true }
      if (-not $appBlocked) { exit 9 }
    `);
  });

  test('projects PM2 state without process environment or unrelated apps', () => {
    runPowerShell(`
      Get-Command ConvertTo-SafePm2AppState -ErrorAction Stop | Out-Null
      $raw = @(
        [pscustomobject]@{name='lng-hr-be';pm_id=0;pid=101;pm2_env=[pscustomobject]@{status='online';restart_time=3;SECRET_TOKEN='must-not-leak'}},
        [pscustomobject]@{name='unrelated';pm_id=9;pid=999;pm2_env=[pscustomobject]@{status='online';SECRET_TOKEN='also-private'}}
      )
      $safe = @(ConvertTo-SafePm2AppState -Pm2Apps $raw -RequiredAppNames @('lng-hr-be','lng-hr-cron'))
      $json = ConvertTo-Json -InputObject $safe -Depth 6 -Compress
      if ($safe.Count -ne 1 -or $safe[0].name -ne 'lng-hr-be' -or $safe[0].restartCount -ne 3) { exit 9 }
      if ($json -match 'SECRET|must-not-leak|unrelated|also-private') { exit 10 }
    `);
  });

  test('decodes a PM2 jlist JSON array into individual safe app records', () => {
    runPowerShell(`
      Get-Command ConvertFrom-Pm2JlistSafeState -ErrorAction Stop | Out-Null
      $jlist = '[{"name":"lng-hr-be","pm_id":0,"pid":101,"pm2_env":{"status":"online","restart_time":3,"SECRET_TOKEN":"must-not-leak"}},{"name":"lng-hr-cron","pm_id":1,"pid":102,"pm2_env":{"status":"online","restart_time":4}}]'
      $safe = @(ConvertFrom-Pm2JlistSafeState -JlistJson $jlist -RequiredAppNames @('lng-hr-be','lng-hr-cron'))
      if ($safe.Count -ne 2 -or ($safe.name -join ',') -ne 'lng-hr-be,lng-hr-cron') { exit 10 }
      if ((ConvertTo-Json -InputObject $safe -Depth 4 -Compress) -match 'SECRET|must-not-leak|pm2_env') { exit 11 }
    `);
  });

  test('validates the explicit SQL attendance PID and discovers every restarted exact process', () => {
    runPowerShell(`
      Get-Command Assert-LegacySqlAttendanceProcessBinding -ErrorAction Stop | Out-Null
      Get-Command Get-LegacySqlAttendanceProcesses -ErrorAction Stop | Out-Null
      $processes = @(
        [pscustomobject]@{ProcessId=13;Name='node.exe';CommandLine='node sql-attendance-worker.js'},
        [pscustomobject]@{ProcessId=14;Name='node.exe';CommandLine='node C:\\legacy\\sql-attendance-worker.js'},
        [pscustomobject]@{ProcessId=15;Name='node.exe';CommandLine='node server.js'}
      )
      Assert-LegacySqlAttendanceProcessBinding -Processes $processes -ProcessId 13
      $matches = @(Get-LegacySqlAttendanceProcesses -Processes $processes)
      if (($matches.ProcessId | Sort-Object) -join ',' -ne '13,14') { exit 11 }

      $wrongBlocked = $false
      try { Assert-LegacySqlAttendanceProcessBinding -Processes $processes -ProcessId 15 } catch { $wrongBlocked = $true }
      if (-not $wrongBlocked) { exit 12 }
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
