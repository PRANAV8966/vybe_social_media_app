const fs = require('fs');
const path = require('path');

const ecosystem = require('../../ecosystem.config');

describe('ecosystem.config.js (PM2)', () => {
  it('defines exactly one app named vybe-backend', () => {
    expect(ecosystem.apps).toHaveLength(1);
    expect(ecosystem.apps[0].name).toBe('vybe-backend');
  });

  const app = () => ecosystem.apps[0];

  it('points at the real entrypoint script', () => {
    const scriptPath = path.join(app().cwd, app().script);
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it('runs a single fork-mode instance, not clustered', () => {
    // Our rate limiter uses an in-memory store per process — clustering would
    // silently multiply the effective rate limit across workers. Single fork
    // instance is a deliberate choice, not an oversight; this test guards
    // against someone bumping `instances` without addressing that first.
    expect(app().exec_mode).toBe('fork');
    expect(app().instances).toBe(1);
  });

  it('has crash-loop protection configured', () => {
    expect(app().autorestart).toBe(true);
    expect(typeof app().max_restarts).toBe('number');
    expect(app().max_restarts).toBeGreaterThan(0);
    expect(typeof app().min_uptime).toBe('string');
    expect(typeof app().restart_delay).toBe('number');
    expect(app().restart_delay).toBeGreaterThan(0);
  });

  it('caps memory with an automatic restart', () => {
    expect(app().max_memory_restart).toEqual(expect.any(String));
  });

  it('does not watch the filesystem (nodemon owns that in dev; watching in prod risks restart loops)', () => {
    expect(app().watch).toBe(false);
  });

  it('does not double-timestamp log lines — pino already timestamps every entry', () => {
    expect(app().time).toBe(false);
  });

  it('uses absolute log file paths, independent of the invoking shell\'s cwd', () => {
    // PM2 resolves relative error_file/out_file/log_file against whatever
    // directory `pm2` was invoked from, not this file's location — a well
    // known footgun (Unitech/pm2#3164). Every log path must be absolute.
    for (const key of ['error_file', 'out_file', 'log_file']) {
      expect(path.isAbsolute(app()[key])).toBe(true);
    }
  });

  it('keeps all three log files inside this project\'s own logs/ directory', () => {
    const logsDir = path.join(__dirname, '..', '..', 'logs');
    for (const key of ['error_file', 'out_file', 'log_file']) {
      expect(path.dirname(app()[key])).toBe(logsDir);
    }
  });

  it('does not duplicate env config that env.js already loads from .env', () => {
    // A second source of truth for JWT secrets / Mongo URI / etc. here could
    // silently drift from the real .env file. env.js is the only place that
    // should ever construct the running config.
    expect(app().env).toBeUndefined();
    expect(app().env_file).toBeUndefined();
  });
});
