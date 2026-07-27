# HR rollback runbook

Legacy writes may reopen only before the first POD production HR write. Once
the `FIRST_POD_PRODUCTION_HR_WRITE` marker exists, recovery is forward-only.

## Decide the rollback direction

```powershell
$ErrorActionPreference = 'Stop'
$LegacyRoot = 'C:\lng_system\lng-hr\lng-hr-be'
$PodRoot = 'C:\lng_system\lng-web\lng-web-be'
$EvidenceRoot = Read-Host 'Absolute cutover evidence directory'
$FirstWriteMarker = Join-Path $EvidenceRoot 'FIRST_POD_PRODUCTION_HR_WRITE.json'
if (Test-Path $FirstWriteMarker) {
  throw 'STOP: FIRST_POD_PRODUCTION_HR_WRITE exists; use forward-only recovery and do not reopen legacy writes'
}
```

If a POD HR mutation occurred but the marker was not written, create the marker
from the audit evidence first and use forward-only recovery.

## Pre-write rollback

Stop only the POD HR host worker processes. Do not delete target data.

```powershell
Set-Location $PodRoot
$WorkerEvidence = Join-Path $EvidenceRoot 'pod-hr-workers.json'
if (-not (Test-Path $WorkerEvidence)) { throw 'STOP: POD HR worker PID evidence is missing' }
$PodHrWorkers = @(Get-Content -Raw $WorkerEvidence | ConvertFrom-Json)
$PodHrWorkers | Select-Object Id, ProcessName
$PodHrWorkers | ForEach-Object {
  $Current = Get-Process -Id $_.Id -ErrorAction Stop
  if ($Current.ProcessName -ne $_.ProcessName -or $Current.StartTime.ToUniversalTime() -ne ([datetime]$_.StartTime).ToUniversalTime()) {
    throw "STOP: PID $($_.Id) no longer identifies the recorded worker wrapper"
  }
}
$Confirmation = Read-Host 'Type STOP POD HR WORKERS'
if ($Confirmation -cne 'STOP POD HR WORKERS') { throw 'STOP: worker stop not confirmed' }
$PodHrWorkers | ForEach-Object { Stop-Process -Id $_.Id -ErrorAction Stop }
```

Verify the source backup and legacy database are intact. Restore a database only
to a new validation name first; never restore over either live database in this
runbook.

```powershell
$SourceBackup = Join-Path $EvidenceRoot 'source-lng-hr'
if (-not (Get-ChildItem $SourceBackup -Recurse -Filter '*.bson.gz')) { throw 'STOP: source backup is missing' }
$ValidationDb = "rollback_validation_$((Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))"
if ($ValidationDb -in @('lng_hr', 'lng_web_be') -or $ValidationDb -notmatch '^rollback_validation_[0-9]{14}$') { throw 'STOP: unsafe validation database name' }
mongorestore --uri="$env:MONGODB_URI" --gzip --nsInclude='lng_hr.*' --nsFrom='lng_hr.*' --nsTo="$ValidationDb.*" "$SourceBackup"
if ($LASTEXITCODE -ne 0) { throw 'STOP: validation restore failed' }
```

On the Windows legacy host, restart only the exact repository scripts that were
frozen. If production uses an orchestrator, use its reviewed commands instead.

```powershell
Set-Location $LegacyRoot
Start-Process npm.cmd -ArgumentList 'start' -WorkingDirectory $LegacyRoot -WindowStyle Hidden
Start-Process npm.cmd -ArgumentList 'run','cron:worker' -WorkingDirectory $LegacyRoot -WindowStyle Hidden
Start-Process npm.cmd -ArgumentList 'run','sql-attendance:worker' -WorkingDirectory $LegacyRoot -WindowStyle Hidden
```

Record the reason, operator, timestamps, process IDs and smoke evidence in the
cutover evidence directory. Keep the POD target for investigation; do not run
both backends as HR writers.

## Post-write recovery

When `FIRST_POD_PRODUCTION_HR_WRITE` exists, do not restore the old target over
POD and do not reopen legacy writers. Fix forward in POD, replay idempotent
imports/events where supported, reconcile attendance and payroll, rerun
`npm run compare:hr:payroll -- ...`, then rerun
`npm run audit:hr:readiness -- ...`.
