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
$Window = Get-Date -Format 'yyyyMMdd-HHmmss'
$EvidenceRoot = Join-Path $PodRoot "storage/hr-cutover/$Window"
New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
```

STOP unless the reviewed shadow evidence contains zero approved differences,
the target/source database names were independently verified, backups have
enough free storage, and the rollback owner is present.

## Freeze legacy writers

The legacy repository has no Compose or read-only switch. On its Windows host,
identify only its exact Node entrypoints before stopping them:

```powershell
$LegacyEntries = @('server.js', 'cron-worker.js', 'sql-attendance-worker.js')
$LegacyProcesses = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'node.exe' -and $_.CommandLine -like "*$LegacyRoot*" -and
  ($LegacyEntries | Where-Object { $_.CommandLine -like "*$_*" })
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
npm run migrate:hr:lng-hr 2>&1 | Tee-Object (Join-Path $EvidenceRoot 'delta-dry-run.log')
if ($LASTEXITCODE -ne 0) { throw 'STOP: final dry-run failed' }
npm run migrate:hr:lng-hr -- --apply 2>&1 | Tee-Object (Join-Path $EvidenceRoot 'delta-apply.log')
if ($LASTEXITCODE -ne 0) { throw 'STOP: final reconciliation failed' }
$CompareFile = Join-Path $EvidenceRoot "payroll-compare-$Year-$Month.json"
npm run compare:hr:payroll -- --month=$Month --year=$Year --report-file=$CompareFile
if ($LASTEXITCODE -ne 0) { throw 'STOP: payroll comparison failed' }
npm run audit:hr:readiness -- --payroll-diff-file=$CompareFile --migration-idempotent 2>&1 | Tee-Object (Join-Path $EvidenceRoot 'readiness.log')
if ($LASTEXITCODE -ne 0) { throw 'STOP: readiness audit failed' }
```

## Enable POD workers and UI

```powershell
docker compose config | Out-File -Encoding utf8 (Join-Path $EvidenceRoot 'compose-infra.yml')
docker compose up -d mongodb redis --wait
if ($LASTEXITCODE -ne 0) { throw 'STOP: POD infrastructure failed to become healthy' }
$SqlWorker = Start-Process npm.cmd -ArgumentList 'run','worker:sql-attendance' -WorkingDirectory $PodRoot -WindowStyle Hidden -PassThru
$AnnouncementWorker = Start-Process npm.cmd -ArgumentList 'run','worker:hr-announcements' -WorkingDirectory $PodRoot -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 3
@($SqlWorker, $AnnouncementWorker) | Select-Object Id, ProcessName, StartTime, HasExited | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'pod-hr-workers.json')
if ($SqlWorker.HasExited -or $AnnouncementWorker.HasExited) { throw 'STOP: POD HR worker failed to stay running' }

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

## First production write boundary

After the first legitimate POD HR mutation succeeds, record its real route,
resource ID, actor and audit/event ID. This marker permanently closes legacy
write rollback.

```powershell
[ordered]@{
  event = 'FIRST_POD_PRODUCTION_HR_WRITE'
  occurredAt = (Get-Date).ToUniversalTime().ToString('o')
  route = Read-Host 'Successful POD HR mutation route'
  resourceId = Read-Host 'Written resource ID'
  actorAccountId = Read-Host 'Actor account ID'
  auditEventId = Read-Host 'Audit/event ID'
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'FIRST_POD_PRODUCTION_HR_WRITE.json')
```

Do not declare legacy retired until this window passes, the required shadow
period is approved, and the seven-day read-only audit reference window closes.
