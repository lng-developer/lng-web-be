module.exports = {
  apps: [{
    name: 'lng-web-be',
    script: 'src/server.js',
    cwd: __dirname,
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    min_uptime: 10_000,
    max_restarts: 5,
    exp_backoff_restart_delay: 100,
    kill_timeout: 10_000,
    merge_logs: true,
  }],
};
