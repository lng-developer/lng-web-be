# Background process cutover

The existing PM2 deployment in `/srv/lng-web-be` starts `lng-web-be` through `ecosystem.config.js`. It remains the default combined API, worker and scheduler. The split profile in `ecosystem.split.config.js` keeps `lng-web-be` as the only HTTP process and adds one `lng-web-be-worker` and one `lng-web-be-scheduler` process. Each split process reports `runtime_ready` and sends PM2 its ready signal after its dependencies connect and its assigned services start.

To rehearse locally, use a disposable MongoDB replica set and a dedicated Redis database. Start separate terminals with `RUNTIME_ROLE=api` and `npm start`, `npm run start:worker`, and `npm run start:scheduler` using the flags below. Restart the worker and interrupt Redis while observing HTTP health, queue enqueue latency, worker reconnects, and recovery of saved requests.

## Before approval

- Compare API p95, MongoDB latency, queue age, tracking age, retries and vendor throttling against the [combined baseline](background-flow-baseline.md). Measure an import burst with comparable work.
- Validate and roll out the durable paths in combined mode before splitting. Confirm vendor limits, Redis persistence and capacity, MongoDB capacity for three pools of up to 20 connections, and the [durability and recovery gates](superpowers/plans/2026-11-23-background-flow-optimization.md).
- In the separately approved deployment, run `npm run indexes:background-flow` on the exact release with the target database settings before enabling flags. The command creates the durable request and vendor poll indexes and the finance guard collection. It can be rerun.
- The split profile requires `REDIS_ENABLED=true`, `MAPPING_DURABLE_SIDE_EFFECTS_ENABLED=true`, `FINANCE_DURABLE_RECALCULATION_ENABLED=true` and `VENDOR_TRACKING_QUEUE_ENABLED=true` in the shared deployment environment. The three processes must use the same MongoDB database, Redis namespace and queue configuration.

Keep one scheduler and one worker process initially. Worker capacity per queue is per-process concurrency multiplied by process count.

| Queue | Initial local concurrency per process |
| --- | ---: |
| External order import | 1 |
| Customization assets | 3 |
| Etsy listing images | 2 |
| Post-import mapping | 3 |
| Fulfillment side effects | 5 |
| Finance snapshot | 3 |
| Finance import | 2 |
| Order recheck | 2 |
| Vendor tracking | 2 |

Tracking also enforces shared vendor and credential limits. Account for any independently managed import workers before sizing the split worker. Keep existing domain locks in place and verify no independently launched process duplicates the queues above.

## Cutover

Use the same PM2 account as the deployment workflow, which invokes `sudo -n /usr/bin/pm2`. Run the following from `/srv/lng-web-be` during the approved window. Wait for the previous command and verify process exit or readiness at each transition.

1. Check current failed/waiting/active counts and record the exact release SHA. Let long-running work finish before stopping the combined process. Stop and remove that PM2 entry before starting any split consumer.

   ```sh
   sudo -n /usr/bin/pm2 stop lng-web-be
   sudo -n /usr/bin/pm2 delete lng-web-be
   ```

2. Start the split API and verify existing HTTP health and its `runtime_ready` log.

   ```sh
   sudo -n /usr/bin/pm2 start ecosystem.split.config.js --only lng-web-be
   curl -fsS http://127.0.0.1:3000/api/mapping/health
   ```

3. Start the worker, then start the single scheduler. Check the role-specific ready logs and stable PM2 restart counts. Confirm queue age falls and durable requests recover after a controlled worker restart. Save the PM2 list after all checks pass.

   ```sh
   sudo -n /usr/bin/pm2 start ecosystem.split.config.js --only lng-web-be-worker
   sudo -n /usr/bin/pm2 start ecosystem.split.config.js --only lng-web-be-scheduler
   sudo -n /usr/bin/pm2 save
   ```

4. Compare equivalent workload windows. Watch `background_job_finished`, `runtime_worker_error`, `background_queue_producer_error`, and the domain recovery logs. Default split producers reject failed Redis commands promptly. Mapping and finance retain durable requests for replay. During a Redis interruption the realtime notification stream may miss a live event. The saved notification remains available in the inbox.

The existing single-process GitHub deployment checks PM2 before modifying the checkout and refuses deployment while the split profile is active. Use a coordinated deployment for updates in split mode. Stop and drain the scheduler, worker and API before replacing the checkout or dependencies, then restart API, worker and scheduler from the same verified revision. Keep the Redis queues and MongoDB request collections through upgrades and rollbacks. Check for long-running jobs before PM2's 120-second split drain timeout.

## Rollback

1. Stop and remove the scheduler. Stop and remove the worker after active work drains. Stop and remove the split API to avoid serving two stacks. Verify all split processes exited before continuing.
2. Keep the durable flags enabled and return to combined mode on the same compatible revision. Confirm one scheduler and one set of workers resume processing.

   ```sh
   sudo -n /usr/bin/pm2 start ecosystem.config.js --only lng-web-be
   curl -fsS http://127.0.0.1:3000/api/mapping/health
   sudo -n /usr/bin/pm2 save
   ```

3. Verify ready logs, stable restart counts and recovered requests. Drain or reconcile durable work before separately disabling a durable path or moving to a revision that cannot process its queued payloads.
