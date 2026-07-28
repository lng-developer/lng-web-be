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

## Keep POD HR mutation ingress unavailable

The repository has no generic gateway command. Before any cutover work, execute
the reviewed external gateway/deployment-manager procedure that keeps POD HR
mutation ingress unavailable, then archive the operator assertion. Do not invent
a service name.

```powershell
$IngressProcedureId = Read-Host 'Reviewed ingress procedure/change ID'
if ([string]::IsNullOrWhiteSpace($IngressProcedureId)) { throw 'STOP: reviewed ingress procedure ID is required' }
$IngressConfirmation = Read-Host 'Type POD HR MUTATION INGRESS DISABLED'
if ($IngressConfirmation -cne 'POD HR MUTATION INGRESS DISABLED') { throw 'STOP: POD HR ingress is not confirmed disabled' }
[ordered]@{
  procedureId = $IngressProcedureId
  state = 'DISABLED'
  confirmedAt = (Get-Date).ToUniversalTime().ToString('o')
  operator = Read-Host 'Ingress operator'
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'pod-hr-ingress-disabled.json')
```

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

The reviewed legacy `ecosystem.config.js` owns `server.js` as PM2 app
`lng-hr-be` and `cron-worker.js` as `lng-hr-cron`. PM2 must remain the owner of
those processes during freeze: never kill its child PIDs directly. The separate
`sql-attendance-worker.js` is not in that ecosystem and requires one explicit
exact PID binding.

```powershell
$Pm2Executable = (Get-Command pm2.cmd -ErrorAction Stop).Source
$LegacyPm2AppNames = @('lng-hr-be', 'lng-hr-cron')
$Pm2BeforeJson = (& $Pm2Executable jlist) -join [Environment]::NewLine
$Pm2BeforeExit = $LASTEXITCODE
if ($Pm2BeforeExit -ne 0 -or [string]::IsNullOrWhiteSpace($Pm2BeforeJson)) { throw 'STOP: PM2 jlist failed before freeze' }
$Pm2Before = @(ConvertFrom-Pm2JlistSafeState -JlistJson $Pm2BeforeJson -RequiredAppNames $LegacyPm2AppNames)
foreach ($appName in $LegacyPm2AppNames) {
  if (@($Pm2Before | Where-Object { $_.name -eq $appName }).Count -eq 0) { throw "STOP: required PM2 app $appName is missing" }
}
ConvertTo-Json -InputObject $Pm2Before -Depth 4 | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'legacy-pm2-before-freeze.json')

$LegacySqlProcessId = [int](Read-Host 'Exact PID for legacy sql-attendance-worker.js')
$LegacyProcesses = @(Get-CimInstance Win32_Process)
Assert-LegacySqlAttendanceProcessBinding -Processes $LegacyProcesses -ProcessId $LegacySqlProcessId
$LegacySqlMatches = @(Get-LegacySqlAttendanceProcesses -Processes $LegacyProcesses)
if ($LegacySqlMatches.Count -ne 1 -or $LegacySqlMatches[0].ProcessId -ne $LegacySqlProcessId) {
  throw 'STOP: SQL attendance worker topology differs from the reviewed explicit PID'
}
[ordered]@{
  entrypoint = 'sql-attendance-worker.js'
  processId = $LegacySqlProcessId
  exactCommandValidated = $true
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'legacy-sql-attendance-before-freeze.json')

$Confirmation = Read-Host 'Type FREEZE LEGACY HR'
if ($Confirmation -cne 'FREEZE LEGACY HR') { throw 'STOP: freeze not confirmed' }
$LegacyProcesses = @(Get-CimInstance Win32_Process)
Assert-LegacySqlAttendanceProcessBinding -Processes $LegacyProcesses -ProcessId $LegacySqlProcessId

$Pm2StopFailures = @()
foreach ($appName in $LegacyPm2AppNames) {
  & $Pm2Executable stop $appName | Out-Null
  if ($LASTEXITCODE -ne 0) { $Pm2StopFailures += $appName }
}
Stop-Process -Id $LegacySqlProcessId -ErrorAction SilentlyContinue
Wait-Process -Id $LegacySqlProcessId -Timeout 15 -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$Pm2AfterJson = (& $Pm2Executable jlist) -join [Environment]::NewLine
$Pm2AfterExit = $LASTEXITCODE
if ($Pm2AfterExit -ne 0 -or [string]::IsNullOrWhiteSpace($Pm2AfterJson)) { throw 'STOP: PM2 jlist failed after freeze' }
$Pm2After = @(ConvertFrom-Pm2JlistSafeState -JlistJson $Pm2AfterJson -RequiredAppNames $LegacyPm2AppNames)
ConvertTo-Json -InputObject $Pm2After -Depth 4 | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'legacy-pm2-after-freeze.json')
Assert-LegacyHrPm2AppsStopped -Before $Pm2Before -After $Pm2After -RequiredAppNames $LegacyPm2AppNames
if ($Pm2StopFailures.Count -gt 0) { throw "STOP: PM2 stop failed for: $($Pm2StopFailures -join ',')" }

$LegacySqlSurvivors = @(Get-LegacySqlAttendanceProcesses -Processes @(Get-CimInstance Win32_Process))
if ($LegacySqlSurvivors) { throw "STOP: exact legacy SQL attendance worker restarted or remained online: $($LegacySqlSurvivors.ProcessId -join ',')" }
```

These PM2 evidence files contain only app name, PM2 ID, PID, status and restart
count. Never archive raw `pm2 jlist` output because it includes application
environment values. If either exact PM2 app or the SQL PID cannot be proven,
stop the cutover.

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

$Pm2PreApplyJson = (& $Pm2Executable jlist) -join [Environment]::NewLine
$Pm2PreApplyExit = $LASTEXITCODE
if ($Pm2PreApplyExit -ne 0 -or [string]::IsNullOrWhiteSpace($Pm2PreApplyJson)) { throw 'STOP: PM2 jlist failed before apply' }
$Pm2PreApply = @(ConvertFrom-Pm2JlistSafeState -JlistJson $Pm2PreApplyJson -RequiredAppNames $LegacyPm2AppNames)
ConvertTo-Json -InputObject $Pm2PreApply -Depth 4 | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'legacy-pm2-pre-apply.json')
Assert-LegacyHrPm2AppsStopped -Before $Pm2Before -After $Pm2PreApply -RequiredAppNames $LegacyPm2AppNames
$LegacySqlPreApply = @(Get-LegacySqlAttendanceProcesses -Processes @(Get-CimInstance Win32_Process))
if ($LegacySqlPreApply) { throw "STOP: legacy SQL attendance worker restarted before apply: $($LegacySqlPreApply.ProcessId -join ',')" }

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

## Close rollback, then enable POD writers

Creating this marker permanently closes legacy write rollback before any POD
worker that can write is started. This conservative boundary means enabling
writers counts as `FIRST_POD_PRODUCTION_HR_WRITE`, even if no queued mutation
has yet been observed.

```powershell
$IngressConfirmation = Read-Host 'Type POD HR MUTATION INGRESS STILL DISABLED'
if ($IngressConfirmation -cne 'POD HR MUTATION INGRESS STILL DISABLED') { throw 'STOP: ingress state changed before rollback boundary' }
[ordered]@{
  event = 'FIRST_POD_PRODUCTION_HR_WRITE'
  occurredAt = (Get-Date).ToUniversalTime().ToString('o')
  boundaryReason = 'POD_HR_WRITERS_ENABLED'
  actualWriteObserved = $false
  operator = Read-Host 'Cutover operator'
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'FIRST_POD_PRODUCTION_HR_WRITE.json')
if (-not (Test-Path (Join-Path $EvidenceRoot 'FIRST_POD_PRODUCTION_HR_WRITE.json'))) { throw 'STOP: rollback boundary marker missing' }

Write-Host "Execute reviewed ingress procedure $IngressProcedureId now. Rollback is forward-only."
$IngressConfirmation = Read-Host 'Type POD HR MUTATION INGRESS ENABLED'
if ($IngressConfirmation -cne 'POD HR MUTATION INGRESS ENABLED') { throw 'STOP: POD HR ingress was not enabled' }
[ordered]@{
  procedureId = $IngressProcedureId
  state = 'ENABLED'
  confirmedAt = (Get-Date).ToUniversalTime().ToString('o')
  note = 'POD HR mutation ingress is enabled in forward-only mode'
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'pod-hr-ingress-enabled.json')

Set-Location $PodRoot
$NodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$SqlWorkerScript = (Resolve-Path 'src/modules/integration/sqlAttendance/workers/sqlAttendance.worker.js').Path
$AnnouncementWorkerScript = (Resolve-Path 'src/modules/hr/workers/announcement.worker.js').Path
$WorkerEvidenceFile = Join-Path $EvidenceRoot 'pod-hr-workers.json'
$WorkerRecords = @()
Write-HrWorkerEvidenceAtomically -EvidenceFile $WorkerEvidenceFile -Records @()

$SqlWorker = Start-Process $NodeExecutable -ArgumentList "`"$SqlWorkerScript`"" -WorkingDirectory $PodRoot -WindowStyle Hidden -PassThru
$SqlRecord = [pscustomobject][ordered]@{ processId = $SqlWorker.Id; nodeExecutable = $NodeExecutable; scriptPath = $SqlWorkerScript; startTime = $SqlWorker.StartTime.ToUniversalTime().ToString('o') }
Start-Sleep -Seconds 1
$SqlProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($SqlRecord.processId)"
if (-not $SqlProcess -or -not (Test-ExactNodeWorkerProcess -Process $SqlProcess -Record $SqlRecord)) { throw 'STOP: SQL worker did not start as the exact Node script' }
$WorkerRecords += $SqlRecord
Write-HrWorkerEvidenceAtomically -EvidenceFile $WorkerEvidenceFile -Records $WorkerRecords

$AnnouncementWorker = Start-Process $NodeExecutable -ArgumentList "`"$AnnouncementWorkerScript`"" -WorkingDirectory $PodRoot -WindowStyle Hidden -PassThru
$AnnouncementRecord = [pscustomobject][ordered]@{ processId = $AnnouncementWorker.Id; nodeExecutable = $NodeExecutable; scriptPath = $AnnouncementWorkerScript; startTime = $AnnouncementWorker.StartTime.ToUniversalTime().ToString('o') }
Start-Sleep -Seconds 1
$AnnouncementProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($AnnouncementRecord.processId)"
if (-not $AnnouncementProcess -or -not (Test-ExactNodeWorkerProcess -Process $AnnouncementProcess -Record $AnnouncementRecord)) { throw 'STOP: announcement worker did not start as the exact Node script' }
$WorkerRecords += $AnnouncementRecord
Write-HrWorkerEvidenceAtomically -EvidenceFile $WorkerEvidenceFile -Records $WorkerRecords
```

When the first actual mutation is observed, archive its route, resource ID,
actor and audit/event ID separately. The rollback boundary is already closed.

## Forward-only smoke tests

```powershell
$Headers = @{ Authorization = "Bearer $AccessToken" }
Invoke-RestMethod "$PodApiBaseUrl/api/hr/health" | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'smoke-health.json')
Invoke-RestMethod "$PodApiBaseUrl/api/hr/integrations/sql-attendance/status" -Headers $Headers | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'smoke-sql-status.json')
Invoke-RestMethod "$PodApiBaseUrl/api/hr/payrolls?month=$Month&year=$Year&limit=1" -Headers $Headers | Out-Null
Invoke-RestMethod "$PodApiBaseUrl/api/notifications/unread-count" -Headers $Headers | Out-Null
```

Do not declare legacy retired until this window passes, the required shadow
period is approved, and the seven-day read-only audit reference window closes.
