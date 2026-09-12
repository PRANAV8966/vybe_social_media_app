const pino = require('pino');
const env = require('./env');

const logger = pino({
  level: env.isTest ? 'silent' : env.isProduction ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.newPassword',
      'req.body.idToken',
      'res.headers["set-cookie"]',
    ],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
