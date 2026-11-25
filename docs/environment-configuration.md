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
