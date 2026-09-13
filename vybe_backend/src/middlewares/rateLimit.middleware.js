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

/**
 * Tighter limiter for endpoints that can carry a file upload (post
 * create/edit, profile-photo). multer.memoryStorage() holds each upload's
 * full buffer in RAM for the duration of the request — without a stricter
 * cap here, the generalLimiter's budget alone (120/min by default) still
 * allows enough concurrent large uploads to threaten process memory. This
 * applies even to requests that end up being text-only, trading a little
 * strictness on rapid plain posting for a bounded worst case.
 */
const uploadLimiter = rateLimit({
  windowMs: env.rateLimit.uploadWindowMs,
  limit: env.rateLimit.uploadMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many uploads, please slow down.' } },
});

module.exports = { authLimiter, generalLimiter, uploadLimiter };
