const Joi = require('joi');

const usernameParamSchema = Joi.object({
  username: Joi.string().trim().lowercase().pattern(/^[a-z0-9_.]{3,30}$/).required(),
});

const updateProfileSchema = Joi.object({
  name: Joi.string().trim().max(100),
  bio: Joi.string().trim().max(300).allow(''),
  country: Joi.string().length(2).uppercase(),
  isPrivate: Joi.boolean(),
}).min(1);

const searchQuerySchema = Joi.object({
  q: Joi.string().trim().min(1).max(50).required(),
  cursor: Joi.string().trim().allow(''),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

module.exports = { usernameParamSchema, updateProfileSchema, searchQuerySchema };
