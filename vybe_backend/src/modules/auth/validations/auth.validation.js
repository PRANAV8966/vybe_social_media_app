const Joi = require('joi');

/**
 * Password policy follows current NIST 800-63B guidance: prioritize length
 * over forced complexity rules. 8-128 chars, no arbitrary character-class
 * requirements.
 */
const passwordSchema = Joi.string().min(8).max(128).required();

const registerSchema = Joi.object({
  name: Joi.string().trim().max(100).required(),
  username: Joi.string().trim().lowercase().pattern(/^[a-z0-9_.]{3,30}$/).required(),
  email: Joi.string().trim().lowercase().email().required(),
  password: passwordSchema,
  country: Joi.string().length(2).uppercase(),
});

const loginSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required(),
  password: Joi.string().required(),
});

const googleAuthSchema = Joi.object({
  idToken: Joi.string().required(),
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

// Not required — logout with no token at all stays a valid no-op (idempotent logout).
const logoutSchema = Joi.object({
  refreshToken: Joi.string(),
});

module.exports = { registerSchema, loginSchema, googleAuthSchema, refreshTokenSchema, logoutSchema };
