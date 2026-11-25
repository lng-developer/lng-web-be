# Development and production configuration

Backend loads exactly one file from its working directory:

| Runtime | Selector | File |
| --- | --- | --- |
| Local development | default, or `APP_ENV=development` | `.env.development` |
| Develop server | `APP_ENV=development`, `NODE_ENV=production` | `.env.development` |
| Production | `APP_ENV=production`, `NODE_ENV=production` | `.env.production` |
| Tests | `APP_ENV=test` or `NODE_ENV=test` | none; test configuration is injected |

`APP_ENV` takes precedence over `NODE_ENV`. Existing process variables take precedence
over file values. A missing selected file fails startup; legacy `.env` is not a fallback.
Start from `.env.example` on a new machine, then fill the appropriate ignored file.
Never commit real backend environment files.

Local PowerShell: `$env:APP_ENV='development'; npm run dev`.
Production maintenance: `APP_ENV=production npm run <script>` on Linux.
The production PM2 definition selects production explicitly. Develop CI uses the
protected `/home/lng/apps/lng-web-be/.env.development` file. Production uses
`/srv/lng-web-be/.env.production`. Keep legacy files until older releases no longer
need them for rollback.

Frontend uses Vite `.env.development` with `npm run build:dev` and
`.env.production` with `npm run build:prod`. `npm run dev` uses development.
Both deployed builds use empty API/upload URLs for same-origin requests; the local
Vite proxy forwards to localhost:3000. `dev:local` retains its existing localdev mode.
Only public browser configuration belongs in `VITE_*`; never put credentials there.
Vite `.env.local` and mode-specific `.local` overrides still apply on local machines.
Changing frontend configuration requires a rebuild.

## Develop outbound isolation

Development requires `OUTBOUND_MODE=blocked` (also the default). Production and
tests default to `live`; production behavior is unchanged. Setting development to
`live` fails startup. The loader installs the guard before application clients.

- HTTP/HTTPS/fetch and external TCP (including SMTP/SQL) are blocked. Only the
  configured MongoDB hosts (Atlas SRV domain on port 27017) and Redis host/port
  may connect. There is no general localhost, proxy or vendor allowlist.
- Vendor tracking/recovery, extension dispatch, Teams, ads email and SQL attendance
  schedulers remain off even when `BACKGROUND_JOBS_ENABLED=true`. Internal workers
  can still process the isolated database; transport protection applies to them too.
- Extension claim/start/renew operations and Wasabi signing are rejected before granting
  browser-side access. Blocked actions return `OUTBOUND_BLOCKED`, never fake success.
- Develop CI pins blocked outbound and verifies it before deployment. Rollback will
  stop the API rather than restore a release without the isolation guard.

Background jobs remain disabled until a separate test session explicitly enables
them. This is a Node application guard, not an OS firewall: shell programs, other
PM2 applications and previously issued browser commands/signed URLs are outside its
scope. Do not point production-connected browser extensions at develop. New sandbox
integrations require separate credentials/endpoints and a reviewed policy change.
