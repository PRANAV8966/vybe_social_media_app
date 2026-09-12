const Joi = require('joi');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

const objectIdParam = Joi.string().pattern(OBJECT_ID_PATTERN).required();

const createPostSchema = Joi.object({
  text: Joi.string().trim().min(1).max(500).required(),
  imageUrl: Joi.string().uri({ scheme: ['http', 'https'] }).allow(''),
  clientRequestId: Joi.string().trim().max(100),
});

const editPostSchema = Joi.object({
  text: Joi.string().trim().min(1).max(500),
  imageUrl: Joi.string().uri({ scheme: ['http', 'https'] }).allow(''),
}).min(1);

const postIdParamSchema = Joi.object({
  postId: objectIdParam,
});

const usernameParamSchema = Joi.object({
  username: Joi.string().trim().lowercase().pattern(/^[a-z0-9_.]{3,30}$/).required(),
});

const listQuerySchema = Joi.object({
  cursor: Joi.string().pattern(OBJECT_ID_PATTERN),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

module.exports = { createPostSchema, editPostSchema, postIdParamSchema, usernameParamSchema, listQuerySchema };
