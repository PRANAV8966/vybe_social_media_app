const Joi = require('joi');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

const usernameParamSchema = Joi.object({
  username: Joi.string().trim().lowercase().pattern(/^[a-z0-9_.]{3,30}$/).required(),
});

const listQuerySchema = Joi.object({
  cursor: Joi.string().pattern(OBJECT_ID_PATTERN),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

module.exports = { usernameParamSchema, listQuerySchema };
