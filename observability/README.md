# Local API observability

Set `METRICS_ENABLED=true` in the backend `.env`, then run the backend normally:

```powershell
npm run dev
```

Start Prometheus and Grafana:

```powershell
docker compose -f observability/docker-compose.yml up -d
```

- Prometheus: <http://localhost:9090/targets>
- Grafana: <http://localhost:3001> (local default: `admin` / `admin`)

Run the safe local load profiles:

```powershell
npm run load:smoke
npm run load:expected
```

Override `K6_BASE_URL`, `K6_PATH`, or `K6_ACCESS_TOKEN` when needed. A non-loopback target also requires `K6_ALLOW_REMOTE=true`.
