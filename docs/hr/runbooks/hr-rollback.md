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
$ForwardOnly = Test-Path $FirstWriteMarker
if ($ForwardOnly) { Write-Warning 'FIRST_POD_PRODUCTION_HR_WRITE exists; legacy writes must remain closed' }
. (Join-Path $PodRoot 'docs/hr/runbooks/hr-cutover-tools.ps1')
```

If a POD HR mutation occurred but the marker was not written, create the marker
from the audit evidence first and use forward-only recovery.

## Pre-write rollback

This path is valid only before POD writers were enabled. Do not delete target
data.

```powershell
if ($ForwardOnly) { throw 'STOP: use post-boundary forward-only recovery' }
if (Test-Path (Join-Path $EvidenceRoot 'pod-hr-workers.json')) { throw 'STOP: worker evidence exists before rollback boundary' }
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

To stop POD HR workers during forward recovery, validate and stop the exact Node
PIDs recorded at cutover, then prove that no matching worker command remains:

```powershell
if (-not $ForwardOnly) { throw 'STOP: this block is only for post-boundary forward recovery' }
$WorkerEvidence = Join-Path $EvidenceRoot 'pod-hr-workers.json'
$WorkerRecords = if (Test-Path $WorkerEvidence) { @(Get-Content -Raw $WorkerEvidence | ConvertFrom-Json) } else { @() }
$NodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$WorkerDefinitions = @(
  [pscustomobject]@{ nodeExecutable = $NodeExecutable; scriptPath = (Resolve-Path (Join-Path $PodRoot 'src/modules/integration/sqlAttendance/workers/sqlAttendance.worker.js')).Path }
  [pscustomobject]@{ nodeExecutable = $NodeExecutable; scriptPath = (Resolve-Path (Join-Path $PodRoot 'src/modules/hr/workers/announcement.worker.js')).Path }
)
$RunningWorkers = @(Get-ExactNodeWorkerProcesses -Processes @(Get-CimInstance Win32_Process) -WorkerDefinitions $WorkerDefinitions)
[ordered]@{
  recordedPids = @($WorkerRecords.processId)
  runningExactPids = @($RunningWorkers.ProcessId)
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'pod-hr-worker-recovery-plan.json')
$Confirmation = Read-Host 'Type STOP EXACT POD HR WORKERS'
if ($Confirmation -cne 'STOP EXACT POD HR WORKERS') { throw 'STOP: worker stop not confirmed' }
foreach ($process in $RunningWorkers) {
  Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
  Wait-Process -Id $process.ProcessId -Timeout 15 -ErrorAction SilentlyContinue
}
$SurvivingWorkers = @(Get-ExactNodeWorkerProcesses -Processes @(Get-CimInstance Win32_Process) -WorkerDefinitions $WorkerDefinitions)
if ($SurvivingWorkers) { throw "STOP: exact POD HR worker PIDs still running: $($SurvivingWorkers.ProcessId -join ',')" }
```
