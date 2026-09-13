const path = require('path');

/**
 * Log paths MUST be absolute. PM2 resolves relative error_file/out_file/
 * log_file paths against whatever directory the `pm2` CLI was invoked
 * from (or the app's own `cwd`) — NOT against this file's location. That's
 * a well-known PM2 footgun (github.com/Unitech/pm2 issue #3164): running
 * `pm2 start` from a different directory would silently write logs
 * somewhere else, or fail to find them on `pm2 logs`. path.join(__dirname, ...)
 * makes the location independent of the caller's cwd.
 */
const logsDir = path.join(__dirname, 'logs');

module.exports = {
  apps: [
    {
      name: 'vybe-backend',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',

      // Crash-loop protection: if the process dies again within min_uptime
      // more than max_restarts times in a row, PM2 stops auto-restarting
      // and marks the app "errored" instead of spinning forever on a
      // fundamentally broken process.
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      max_memory_restart: '1G',

      // Bounded windows for shutdown/startup, matching the SIGTERM/SIGINT
      // handling already in server.js (server.close() + disconnectDB()
      // before exit).
      kill_timeout: 5000,
      listen_timeout: 3000,

      // nodemon already covers local dev file-watching; PM2 watch would be
      // redundant there and actively dangerous in production (a log write
      // inside a watched path could trigger a restart loop).
      watch: false,

      // pino already timestamps every line as structured JSON — no PM2-side
      // timestamp prefix, so log files stay clean NDJSON (one JSON object
      // per line), pipeable straight into jq/Loki/etc. without preprocessing.
      time: false,

      error_file: path.join(logsDir, 'vybe-backend-error.log'),
      out_file: path.join(logsDir, 'vybe-backend-out.log'),
      log_file: path.join(logsDir, 'vybe-backend-combined.log'),
      merge_logs: true,
    },
  ],
};
