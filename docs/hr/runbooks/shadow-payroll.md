# Shadow payroll rehearsal

Run only from the POD backend checkout in PowerShell. This flow does not start
the payroll email worker and archives no salary values.

## Inputs and evidence directory

```powershell
$ErrorActionPreference = 'Stop'
$Month = 7
$Year = 2026
$PodApiBaseUrl = 'http://localhost:3000'
$AccessToken = Read-Host 'POD access token with HR_PAYROLL:WRITE'
$EvidenceRoot = Join-Path (Get-Location) "storage/hr-rehearsals/$Year-$('{0:D2}' -f $Month)"
New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
$ExpectedSourceDb = 'lng_hr'
$ExpectedTargetDb = 'lng_web_be'
. (Join-Path (Get-Location) 'docs/hr/runbooks/hr-cutover-tools.ps1')
```

## Prove the database targets

The expected development names are `lng_hr` and `lng_web_be`. Stop if either
name differs, if the names are equal, or if `NODE_ENV` is `production`.

```powershell
$DatabaseProbe = @'
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
(async () => {
  if (process.env.NODE_ENV === "production") throw new Error("production rehearsal refused");
  const output = {};
  for (const key of ["SOURCE_MONGODB_URI", "MONGODB_URI"]) {
    if (!process.env[key]) throw new Error(`${key} is required`);
    const connection = await mongoose.createConnection(process.env[key], { serverSelectionTimeoutMS: 10000 }).asPromise();
    output[key] = connection.db.databaseName;
    await connection.close();
  }
  process.stdout.write(JSON.stringify(output));
})().catch((error) => { console.error(error.message); process.exit(1); });
'@
$DatabaseProbe | node | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'database-targets.json')
if ($LASTEXITCODE -ne 0) { throw 'STOP: database target probe failed' }
$Targets = Get-Content -Raw (Join-Path $EvidenceRoot 'database-targets.json') | ConvertFrom-Json
if ($Targets.SOURCE_MONGODB_URI -ne $ExpectedSourceDb -or $Targets.MONGODB_URI -ne $ExpectedTargetDb) { throw 'STOP: unexpected development database target' }
if ($Targets.SOURCE_MONGODB_URI -eq $Targets.MONGODB_URI) { throw 'STOP: source and target databases are identical' }
```

## Dry-run, then explicit apply

```powershell
$DryRunFile = Join-Path $EvidenceRoot 'migration-dry-run.json'
node src/modules/hr/scripts/runLngHrMigration.js --report-file="$DryRunFile"
$DryRunExit = $LASTEXITCODE
if (-not (Test-Path $DryRunFile)) { throw 'STOP: migration dry-run report missing' }
$DryRun = Get-Content -Raw $DryRunFile | ConvertFrom-Json
Assert-HrMigrationReport -Report $DryRun -ExpectedMode 'dry-run' -ExpectedSourceDb $ExpectedSourceDb -ExpectedTargetDb $ExpectedTargetDb
if ($DryRunExit -ne 0) { throw 'STOP: migration dry-run failed' }

$Confirmation = Read-Host 'Type APPLY DEVELOPMENT HR MIGRATION'
if ($Confirmation -cne 'APPLY DEVELOPMENT HR MIGRATION') { throw 'STOP: apply was not confirmed' }
$ApplyFile = Join-Path $EvidenceRoot 'migration-apply.json'
node src/modules/hr/scripts/runLngHrMigration.js --apply --report-file="$ApplyFile"
$ApplyExit = $LASTEXITCODE
if (-not (Test-Path $ApplyFile)) { throw 'STOP: migration apply report missing' }
$Apply = Get-Content -Raw $ApplyFile | ConvertFrom-Json
Assert-HrMigrationReport -Report $Apply -ExpectedMode 'apply' -ExpectedSourceDb $ExpectedSourceDb -ExpectedTargetDb $ExpectedTargetDb
if ($ApplyExit -ne 0) { throw 'STOP: migration apply failed' }
```

Replay the apply and machine-check that it has no inserted, updated, skipped,
or failed row before asserting idempotency.

```powershell
$ReplayFile = Join-Path $EvidenceRoot 'migration-replay-apply.json'
node src/modules/hr/scripts/runLngHrMigration.js --apply --report-file="$ReplayFile"
$ReplayExit = $LASTEXITCODE
if (-not (Test-Path $ReplayFile)) { throw 'STOP: migration replay report missing' }
$Replay = Get-Content -Raw $ReplayFile | ConvertFrom-Json
Assert-HrMigrationReport -Report $Replay -ExpectedMode 'apply' -ExpectedSourceDb $ExpectedSourceDb -ExpectedTargetDb $ExpectedTargetDb -RequireNoWrites
if ($ReplayExit -ne 0) { throw 'STOP: migration replay failed' }
$MigrationIdempotent = $true
```

## Prove delivery is suppressed and calculate the shadow

Delivery suppression currently means no `worker:payroll-email` host process is
running and the `/email` endpoint is never called.

```powershell
$RunningDelivery = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'node.exe' -and $_.CommandLine -like '*payrollEmail.worker.js*'
})
if ($RunningDelivery) { throw 'STOP: payroll email worker is running' }

$Headers = @{ Authorization = "Bearer $AccessToken" }
$Body = @{ month = $Month; year = $Year; shadow = $true } | ConvertTo-Json
$Shadow = Invoke-RestMethod -Method Post -Uri "$PodApiBaseUrl/api/hr/payrolls/run" -Headers $Headers -ContentType 'application/json' -Body $Body
if (-not $Shadow.data.shadow -or $Shadow.data.persisted) { throw 'STOP: response is not a non-persisted shadow' }
[ordered]@{
  month = $Month
  year = $Year
  shadow = $Shadow.data.shadow
  persisted = $Shadow.data.persisted
  status = $Shadow.data.status
  resultCount = @($Shadow.data.results).Count
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot 'shadow-summary-salary-free.json')
$Shadow = $null
```

## Compare and audit

The current comparator reads persisted POD payroll results, not the
non-persisted shadow response. Its zero-difference result is migration parity
evidence only; production cutover remains **NO-GO** until shadow-output parity
is connected or independently approved.

```powershell
$CompareFile = Join-Path $EvidenceRoot "payroll-compare-$Year-$Month.json"
npm run compare:hr:payroll -- --month=$Month --year=$Year --report-file=$CompareFile
if ($LASTEXITCODE -ne 0) { throw 'STOP: payroll differences exist' }

if (-not $MigrationIdempotent) { throw 'STOP: migration idempotency was not machine-proven' }
npm run audit:hr:readiness -- --payroll-diff-file=$CompareFile --migration-idempotent 2>&1 | Tee-Object (Join-Path $EvidenceRoot 'readiness.log')
if ($LASTEXITCODE -ne 0) { throw 'STOP: readiness audit failed' }
```

## Stop/go decision

GO for another development rehearsal requires all commands above to succeed,
the salary-free summary to exist, and no delivery worker process. Production cutover is
NO-GO while automatic SQL scheduling controls, an enforced delivery-suppression
switch, or shadow-output comparator evidence remain unresolved.
