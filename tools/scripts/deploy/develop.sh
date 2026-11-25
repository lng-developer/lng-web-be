#!/usr/bin/env bash
set -euo pipefail

test "$(hostname)" = lng
[[ "${DEPLOY_SHA:?}" =~ ^[0-9a-f]{40}$ ]]
test "$(node -p 'process.versions.node.split(".")[0]')" = 24
base=/home/lng/apps/lng-web-be-develop
env_file=/home/lng/apps/lng-web-be/.env
release="$base/releases/$DEPLOY_SHA-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:-1}"
test -f "$env_file"
test ! -e "$release"
mkdir -p "$release"
tar -xf "${1:?source archive required}" -C "$release"
ln -s "$env_file" "$release/.env"
cd "$release"
npm ci --omit=dev
NODE_ENV=production BACKGROUND_JOBS_ENABLED=false node - <<'NODE'
const config = require('./src/config');
const uri = new URL(config.database.uri);
if (uri.pathname !== '/lng_web_be_develop' || config.redis.db !== 15
    || config.backgroundJobsEnabled !== false) {
  throw new Error('Refusing deployment outside isolated develop database/Redis/API-only mode');
}
NODE
# Never reset the old runtime checkout: it contains server-local changes.
DEPLOY_NODE="$(command -v node)" node - <<'NODE'
const fs = require('fs');
fs.writeFileSync('ecosystem.develop.json', JSON.stringify({ apps: [{
  name: 'lng-web-be', cwd: process.cwd(), script: 'src/server.js', args: [],
  interpreter: process.env.DEPLOY_NODE, instances: 1, exec_mode: 'fork',
  min_uptime: 10000, max_restarts: 5, kill_timeout: 10000,
  env: { NODE_ENV: 'production', BACKGROUND_JOBS_ENABLED: 'false',
    TEAMS_SYNC_ENABLED: 'false', TEAMS_OUTBOX_ENABLED: 'false', SQL_ATTENDANCE_ENABLED: 'false',
    AMAZON_ADS_GMAIL_ENABLED: 'false' },
}]}));
NODE
previous=$(readlink -f "$base/current" || true)
rollback() {
  status=$?
  if [ "$status" -ne 0 ]; then
    if [ -n "$previous" ] && [ -f "$previous/ecosystem.develop.json" ]; then
      pm2 delete lng-web-be || true
      pm2 start "$previous/ecosystem.develop.json"
    else
      pm2 stop lng-web-be || true
    fi
    pm2 save
  fi
  exit "$status"
}
trap rollback EXIT
# The legacy dedicated worker must stay stopped on the production-data copy.
pm2 stop lng-web-be-import-workers
pm2 delete lng-web-be || true
pm2 start "$release/ecosystem.develop.json"
node - <<'NODE'
const apps = JSON.parse(require('child_process').execFileSync('pm2', ['jlist'], { encoding: 'utf8' }));
const app = apps.find(item => item.name === 'lng-web-be');
if (app?.pm2_env.pm_cwd !== process.cwd()
    || app.pm2_env.pm_exec_path !== require('path').join(process.cwd(), 'src/server.js')
    || app.pm2_env.BACKGROUND_JOBS_ENABLED !== 'false') {
  throw new Error('PM2 did not activate the intended API-only release');
}
NODE
for i in {1..20}; do
  if curl -fsS --max-time 5 http://127.0.0.1:3000/api/mapping/health >/dev/null; then break; fi
  test "$i" -lt 20
  sleep 2
done
pid=$(pm2 pid lng-web-be)
test "$pid" -gt 0
for i in {1..5}; do
  sleep 2
  curl -fsS --max-time 5 http://127.0.0.1:3000/api/mapping/health >/dev/null
  test "$(pm2 pid lng-web-be)" = "$pid"
done
printf '%s\n' "$DEPLOY_SHA" > "$release/DEPLOYED_SHA"
pm2 save
ln -sfn "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
trap - EXIT
printf 'Develop BE deployed: %s\n' "$DEPLOY_SHA"
