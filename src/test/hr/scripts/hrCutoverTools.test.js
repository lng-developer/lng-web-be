const { execFileSync } = require('child_process');
const path = require('path');

const toolsFile = path.resolve(__dirname, '../../../../docs/hr/runbooks/hr-cutover-tools.ps1');

function runPowerShell(body) {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `. '${toolsFile}'; ${body}`], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

describe('HR cutover PowerShell tools', () => {
  test('matches an exact legacy entry without nested pipeline variable shadowing', () => {
    runPowerShell(`
      $process = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node C:\\lng_system\\lng-hr\\lng-hr-be\\cron-worker.js' }
      if (-not (Test-LegacyHrProcess -Process $process -LegacyRoot 'C:\\lng_system\\lng-hr\\lng-hr-be' -EntryNames @('server.js', 'cron-worker.js'))) { exit 11 }
      if (Test-LegacyHrProcess -Process $process -LegacyRoot 'C:\\other' -EntryNames @('cron-worker.js')) { exit 12 }
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
});
