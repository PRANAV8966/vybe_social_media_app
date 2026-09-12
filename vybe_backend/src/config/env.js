const Joi = require('joi');

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().integer().min(1).default(4000),

  MONGO_URI: Joi.string().uri({ scheme: ['mongodb', 'mongodb+srv'] }).required(),

  CLIENT_ORIGINS: Joi.string().required(),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),
  JWT_ISSUER: Joi.string().default('vybe-backend'),
  JWT_AUDIENCE: Joi.string().default('vybe-app'),

  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),

  COOKIE_SECRET: Joi.string().min(32).required(),

  AUTH_RATE_LIMIT_WINDOW_MS: Joi.number().integer().positive().default(900000),
  AUTH_RATE_LIMIT_MAX: Joi.number().integer().positive().default(10),
  GENERAL_RATE_LIMIT_WINDOW_MS: Joi.number().integer().positive().default(60000),
  GENERAL_RATE_LIMIT_MAX: Joi.number().integer().positive().default(120),

  LOGIN_MAX_FAILED_ATTEMPTS: Joi.number().integer().positive().default(5),
  LOGIN_LOCK_DURATION_MS: Joi.number().integer().positive().default(900000),
}).unknown(true);

const { value: envVars, error } = schema.validate(process.env);

if (error) {
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration: ${error.message}`);
  process.exit(1);
}

const env = {
  nodeEnv: envVars.NODE_ENV,
  isProduction: envVars.NODE_ENV === 'production',
  isTest: envVars.NODE_ENV === 'test',
  port: envVars.PORT,

  mongoUri: envVars.MONGO_URI,

  clientOrigins: envVars.CLIENT_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),

  jwt: {
    accessSecret: envVars.JWT_ACCESS_SECRET,
    accessExpiresIn: envVars.JWT_ACCESS_EXPIRES_IN,
    refreshSecret: envVars.JWT_REFRESH_SECRET,
    refreshExpiresIn: envVars.JWT_REFRESH_EXPIRES_IN,
    issuer: envVars.JWT_ISSUER,
    audience: envVars.JWT_AUDIENCE,
  },

  googleClientId: envVars.GOOGLE_CLIENT_ID,

  cookieSecret: envVars.COOKIE_SECRET,

  rateLimit: {
    authWindowMs: envVars.AUTH_RATE_LIMIT_WINDOW_MS,
    authMax: envVars.AUTH_RATE_LIMIT_MAX,
    generalWindowMs: envVars.GENERAL_RATE_LIMIT_WINDOW_MS,
    generalMax: envVars.GENERAL_RATE_LIMIT_MAX,
  },

  login: {
    maxFailedAttempts: envVars.LOGIN_MAX_FAILED_ATTEMPTS,
    lockDurationMs: envVars.LOGIN_LOCK_DURATION_MS,
  },
};

module.exports = Object.freeze(env);
