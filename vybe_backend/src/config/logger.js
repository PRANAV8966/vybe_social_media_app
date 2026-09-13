const pino = require('pino');
const env = require('./env');

const logger = pino({
  level: env.isTest ? 'silent' : env.isProduction ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.body.password',
      'req.body.newPassword',
      'req.body.idToken',
      'req.body.refreshToken',
    ],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
