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
if ($Targets.SOURCE_MONGODB_URI -ne 'lng_hr' -or $Targets.MONGODB_URI -ne 'lng_web_be') { throw 'STOP: unexpected development database target' }
if ($Targets.SOURCE_MONGODB_URI -eq $Targets.MONGODB_URI) { throw 'STOP: source and target databases are identical' }
```

## Dry-run, then explicit apply

```powershell
npm run migrate:hr:lng-hr 2>&1 | Tee-Object (Join-Path $EvidenceRoot 'migration-dry-run.log')
if ($LASTEXITCODE -ne 0) { throw 'STOP: migration dry-run failed' }

$Confirmation = Read-Host 'Type APPLY DEVELOPMENT HR MIGRATION'
if ($Confirmation -cne 'APPLY DEVELOPMENT HR MIGRATION') { throw 'STOP: apply was not confirmed' }
npm run migrate:hr:lng-hr -- --apply 2>&1 | Tee-Object (Join-Path $EvidenceRoot 'migration-apply.log')
if ($LASTEXITCODE -ne 0) { throw 'STOP: migration apply failed' }
```

Run the dry-run again and inspect the counts. Do not claim idempotency while any
row is unexpectedly inserted, updated, skipped, or failed.

```powershell
npm run migrate:hr:lng-hr 2>&1 | Tee-Object (Join-Path $EvidenceRoot 'migration-replay-dry-run.log')
if ($LASTEXITCODE -ne 0) { throw 'STOP: migration replay failed' }
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

npm run audit:hr:readiness -- --payroll-diff-file=$CompareFile --migration-idempotent 2>&1 | Tee-Object (Join-Path $EvidenceRoot 'readiness.log')
if ($LASTEXITCODE -ne 0) { throw 'STOP: readiness audit failed' }
```

## Stop/go decision

GO for another development rehearsal requires all commands above to succeed,
the salary-free summary to exist, and no delivery worker process. Production cutover is
NO-GO while automatic SQL scheduling controls, an enforced delivery-suppression
switch, or shadow-output comparator evidence remain unresolved.
