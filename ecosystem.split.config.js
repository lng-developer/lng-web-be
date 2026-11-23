const [combined] = require('./ecosystem.config').apps;

const split = {
  ...combined,
  wait_ready: true,
  listen_timeout: 30_000,
  kill_timeout: 120_000,
};

module.exports = {
  apps: [
    { ...split, env: { RUNTIME_ROLE: 'api' } },
    { ...split, name: 'lng-web-be-worker', script: 'src/workers/run.js', env: { RUNTIME_ROLE: 'worker' } },
    { ...split, name: 'lng-web-be-scheduler', script: 'src/schedulers/run.js', env: { RUNTIME_ROLE: 'scheduler' } },
  ],
};
