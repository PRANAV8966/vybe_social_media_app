const rateLimit = require('express-rate-limit');
const env = require('../config/env');

/**
 * Tight limiter for auth endpoints (register/login/refresh) — brute-force /
 * credential-stuffing protection. Keyed by IP (express-rate-limit's default
 * key generator), which is what we want here since an attacker can rotate
 * emails/usernames but not as cheaply rotate source IPs at low sophistication.
 */
const authLimiter = rateLimit({
  windowMs: env.rateLimit.authWindowMs,
  limit: env.rateLimit.authMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts, please try again later.' } },
});

/**
 * Looser, general-purpose limiter for the rest of the API.
 */
const generalLimiter = rateLimit({
  windowMs: env.rateLimit.generalWindowMs,
  limit: env.rateLimit.generalMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please slow down.' } },
});

module.exports = { authLimiter, generalLimiter };
