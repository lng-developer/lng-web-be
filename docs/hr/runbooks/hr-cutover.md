# HR cutover runbook

This is a production maintenance-window checklist. Do not execute it until a
complete shadow period is approved and every readiness gate is green.

## Required inputs

```powershell
$ErrorActionPreference = 'Stop'
$LegacyRoot = 'C:\lng_system\lng-hr\lng-hr-be'
$PodRoot = 'C:\lng_system\lng-web\lng-web-be'
$FrontendRoot = 'C:\lng_system\lng-web\lng-web-fe'
$Month = Read-Host 'Payroll month (1-12)'
$Year = Read-Host 'Payroll year'
$AccessToken = Read-Host 'POD HR administrator access token'
$PodApiBaseUrl = Read-Host 'POD API base URL'
if (-not $env:SOURCE_MONGODB_URI -or -not $env:MONGODB_URI) { throw 'STOP: source and target MongoDB environment variables are required' }
$ExpectedSourceDb = 'lng_hr'
$ExpectedTargetDb = 'lng_web_be'
. (Join-Path $PodRoot 'docs/hr/runbooks/hr-cutover-tools.ps1')
$Window = Get-Date -Format 'yyyyMMdd-HHmmss'
$EvidenceRoot = Join-Path $PodRoot "storage/hr-cutover/$Window"
New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
```

STOP unless the reviewed shadow evidence contains zero approved differences,
the target/source database names were independently verified, backups have
enough free storage, and the rollback owner is present.

## Pre-freeze connected database gate

This read-only migration preflight connects to both databases, writes a safe
machine report, verifies every unresolved category, and archives database names
without exposing either URI. It must pass before legacy processes are touched.

```powershell
Set-Location $PodRoot
$PreFreezeFile = Join-Path $EvidenceRoot 'pre-freeze-migration-dry-run.json'
node src/modules/hr/scripts/runLngHrMigration.js --report-file="$PreFreezeFile"
$PreFreezeExit = $LASTEXITCODE
if (-not (Test-Path $PreFreezeFile)) { throw 'STOP: pre-freeze migration report missing' }
$PreFreeze = Get-Content -Raw $PreFreezeFile | ConvertFrom-Json
Assert-HrMigrationReport -Report $PreFreeze -ExpectedMode 'dry-run' -ExpectedSourceDb $ExpectedSourceDb -ExpectedTargetDb $ExpectedTargetDb
if ($PreFreezeExit -ne 0) { throw 'STOP: pre-freeze migration gate failed' }
[ordered]@{
  SOURCE_MONGODB_URI = $PreFreeze.sourceDb
  MONGODB_URI = $PreFreeze.targetDb
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'database-targets.json')
```

## Freeze legacy writers

The legacy repository has no Compose or read-only switch. On its Windows host,
identify only its exact Node entrypoints before stopping them:

```powershell
$LegacyEntries = @('server.js', 'cron-worker.js', 'sql-attendance-worker.js')
$LegacyProcesses = @(Get-CimInstance Win32_Process | Where-Object {
  Test-LegacyHrProcess -Process $_ -LegacyRoot $LegacyRoot -EntryNames $LegacyEntries
})
$LegacyProcesses | Select-Object ProcessId, CommandLine | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'legacy-processes-before-freeze.json')
if (-not $LegacyProcesses) { throw 'STOP: no exact legacy process was identified; use the real deployment manager' }
$Confirmation = Read-Host 'Type FREEZE LEGACY HR'
if ($Confirmation -cne 'FREEZE LEGACY HR') { throw 'STOP: freeze not confirmed' }
$LegacyProcesses | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction Stop }
if (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like "*$LegacyRoot*" }) { throw 'STOP: a legacy writer is still running' }
```

If production uses a service manager or orchestrator, substitute its reviewed
stop command; never guess a service name.

## Back up both databases

```powershell
$SourceBackup = Join-Path $EvidenceRoot 'source-lng-hr'
$TargetBackup = Join-Path $EvidenceRoot 'target-lng-web-be'
mongodump --uri="$env:SOURCE_MONGODB_URI" --gzip --out="$SourceBackup"
if ($LASTEXITCODE -ne 0) { throw 'STOP: source backup failed' }
mongodump --uri="$env:MONGODB_URI" --gzip --out="$TargetBackup"
if ($LASTEXITCODE -ne 0) { throw 'STOP: target backup failed' }
if (-not (Get-ChildItem $SourceBackup -Recurse -Filter '*.bson.gz') -or -not (Get-ChildItem $TargetBackup -Recurse -Filter '*.bson.gz')) { throw 'STOP: backup artifacts missing' }
```

## Reconcile, compare, and audit

`migrate:hr:lng-hr -- --apply` is the implemented idempotent full
reconciliation; there is no separate delta flag.

```powershell
Set-Location $PodRoot
$DryRunFile = Join-Path $EvidenceRoot 'delta-dry-run.json'
node src/modules/hr/scripts/runLngHrMigration.js --report-file="$DryRunFile"
$DryRunExit = $LASTEXITCODE
if (-not (Test-Path $DryRunFile)) { throw 'STOP: final dry-run report missing' }
$DryRun = Get-Content -Raw $DryRunFile | ConvertFrom-Json
Assert-HrMigrationReport -Report $DryRun -ExpectedMode 'dry-run' -ExpectedSourceDb $ExpectedSourceDb -ExpectedTargetDb $ExpectedTargetDb
if ($DryRunExit -ne 0) { throw 'STOP: final dry-run failed' }

$ApplyFile = Join-Path $EvidenceRoot 'delta-apply.json'
node src/modules/hr/scripts/runLngHrMigration.js --apply --report-file="$ApplyFile"
$ApplyExit = $LASTEXITCODE
if (-not (Test-Path $ApplyFile)) { throw 'STOP: final apply report missing' }
$Apply = Get-Content -Raw $ApplyFile | ConvertFrom-Json
Assert-HrMigrationReport -Report $Apply -ExpectedMode 'apply' -ExpectedSourceDb $ExpectedSourceDb -ExpectedTargetDb $ExpectedTargetDb
if ($ApplyExit -ne 0) { throw 'STOP: final reconciliation failed' }

$ReplayFile = Join-Path $EvidenceRoot 'delta-replay-apply.json'
node src/modules/hr/scripts/runLngHrMigration.js --apply --report-file="$ReplayFile"
$ReplayExit = $LASTEXITCODE
if (-not (Test-Path $ReplayFile)) { throw 'STOP: reconciliation replay report missing' }
$Replay = Get-Content -Raw $ReplayFile | ConvertFrom-Json
Assert-HrMigrationReport -Report $Replay -ExpectedMode 'apply' -ExpectedSourceDb $ExpectedSourceDb -ExpectedTargetDb $ExpectedTargetDb -RequireNoWrites
if ($ReplayExit -ne 0) { throw 'STOP: reconciliation replay failed' }
$MigrationIdempotent = $true

$CompareFile = Join-Path $EvidenceRoot "payroll-compare-$Year-$Month.json"
npm run compare:hr:payroll -- --month=$Month --year=$Year --report-file=$CompareFile
if ($LASTEXITCODE -ne 0) { throw 'STOP: payroll comparison failed' }
if (-not $MigrationIdempotent) { throw 'STOP: migration idempotency was not machine-proven' }
npm run audit:hr:readiness -- --payroll-diff-file=$CompareFile --migration-idempotent 2>&1 | Tee-Object (Join-Path $EvidenceRoot 'readiness.log')
if ($LASTEXITCODE -ne 0) { throw 'STOP: readiness audit failed' }
```

## Verify POD infrastructure and UI

```powershell
docker compose config | Out-File -Encoding utf8 (Join-Path $EvidenceRoot 'compose-infra.yml')
docker compose up -d mongodb redis --wait
if ($LASTEXITCODE -ne 0) { throw 'STOP: POD infrastructure failed to become healthy' }

Set-Location $FrontendRoot
node --test "src/**/*.test.js"
if ($LASTEXITCODE -ne 0) { throw 'STOP: frontend tests failed' }
npm run lint
if ($LASTEXITCODE -ne 0) { throw 'STOP: frontend lint failed' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'STOP: frontend build failed' }
```

The current POD SQL worker has no cron scheduler, enabled flag, or lookback
control. Schedule authenticated `POST /api/hr/integrations/sql-attendance/sync`
calls externally before GO. Do not start `npm run worker:payroll-email` until
SMTP credentials and the explicit delivery decision are verified.

## Smoke tests

```powershell
$Headers = @{ Authorization = "Bearer $AccessToken" }
Invoke-RestMethod "$PodApiBaseUrl/api/hr/health" | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'smoke-health.json')
Invoke-RestMethod "$PodApiBaseUrl/api/hr/integrations/sql-attendance/status" -Headers $Headers | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'smoke-sql-status.json')
Invoke-RestMethod "$PodApiBaseUrl/api/hr/payrolls?month=$Month&year=$Year&limit=1" -Headers $Headers | Out-Null
Invoke-RestMethod "$PodApiBaseUrl/api/notifications/unread-count" -Headers $Headers | Out-Null
```

## Close rollback, then enable POD writers

Creating this marker permanently closes legacy write rollback before any POD
worker that can write is started. This conservative boundary means enabling
writers counts as `FIRST_POD_PRODUCTION_HR_WRITE`, even if no queued mutation
has yet been observed.

```powershell
[ordered]@{
  event = 'FIRST_POD_PRODUCTION_HR_WRITE'
  occurredAt = (Get-Date).ToUniversalTime().ToString('o')
  boundaryReason = 'POD_HR_WRITERS_ENABLED'
  actualWriteObserved = $false
  operator = Read-Host 'Cutover operator'
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'FIRST_POD_PRODUCTION_HR_WRITE.json')
if (-not (Test-Path (Join-Path $EvidenceRoot 'FIRST_POD_PRODUCTION_HR_WRITE.json'))) { throw 'STOP: rollback boundary marker missing' }

Set-Location $PodRoot
$NodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$SqlWorkerScript = (Resolve-Path 'src/modules/integration/sqlAttendance/workers/sqlAttendance.worker.js').Path
$AnnouncementWorkerScript = (Resolve-Path 'src/modules/hr/workers/announcement.worker.js').Path
$SqlWorker = Start-Process $NodeExecutable -ArgumentList "`"$SqlWorkerScript`"" -WorkingDirectory $PodRoot -WindowStyle Hidden -PassThru
$AnnouncementWorker = Start-Process $NodeExecutable -ArgumentList "`"$AnnouncementWorkerScript`"" -WorkingDirectory $PodRoot -WindowStyle Hidden -PassThru
$WorkerRecords = @(
  [ordered]@{ processId = $SqlWorker.Id; nodeExecutable = $NodeExecutable; scriptPath = $SqlWorkerScript; startTime = $SqlWorker.StartTime.ToUniversalTime().ToString('o') }
  [ordered]@{ processId = $AnnouncementWorker.Id; nodeExecutable = $NodeExecutable; scriptPath = $AnnouncementWorkerScript; startTime = $AnnouncementWorker.StartTime.ToUniversalTime().ToString('o') }
)
$WorkerRecords | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'pod-hr-workers.json')
Start-Sleep -Seconds 3
foreach ($record in $WorkerRecords) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($record.processId)"
  if (-not $process -or -not (Test-ExactNodeWorkerProcess -Process $process -Record $record)) {
    throw "STOP: worker PID $($record.processId) does not match its exact Node script"
  }
}
```

When the first actual mutation is observed, archive its route, resource ID,
actor and audit/event ID separately. The rollback boundary is already closed.

Do not declare legacy retired until this window passes, the required shadow
period is approved, and the seven-day read-only audit reference window closes.
