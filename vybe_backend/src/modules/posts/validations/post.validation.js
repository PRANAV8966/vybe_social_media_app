const Joi = require('joi');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

const objectIdParam = Joi.string().pattern(OBJECT_ID_PATTERN).required();

const clientRequestIdSchema = Joi.string().trim().pattern(/^[a-zA-Z0-9_-]{1,100}$/);

const createPostSchema = Joi.object({
  text: Joi.string().trim().min(1).max(500).required(),
  clientRequestId: clientRequestIdSchema,
});

// No `.min(1)` here deliberately: media arrives as `req.file`, invisible to
// this schema, so "text and/or media" is enforced in PostService instead —
// an edit that only replaces media (no text field at all) must still pass.
const editPostSchema = Joi.object({
  text: Joi.string().trim().min(1).max(500),
});

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

// PUT "set my like state" — a boolean body, not a toggle, so a client retry
// after a timeout is always safe (see LikeService.setLikeState).
const setLikeStateSchema = Joi.object({
  liked: Joi.boolean().required(),
});

module.exports = {
  createPostSchema,
  editPostSchema,
  postIdParamSchema,
  usernameParamSchema,
  listQuerySchema,
  setLikeStateSchema,
};
