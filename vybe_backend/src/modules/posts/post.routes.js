const { Router } = require('express');
const asyncHandler = require('../../middlewares/asyncHandler');
const { validate } = require('../../middlewares/validate.middleware');
const { authGuard } = require('../auth/guards/authGuard');
const {
  createPostSchema,
  editPostSchema,
  postIdParamSchema,
  usernameParamSchema,
  listQuerySchema,
} = require('./validations/post.validation');

function buildPostRoutes(container) {
  const router = Router();
  const controller = container.resolve('postController');

  router.use(authGuard);

  router.post('/', validate(createPostSchema, 'body'), asyncHandler(controller.create));
  router.patch('/:postId', validate(postIdParamSchema, 'params'), validate(editPostSchema, 'body'), asyncHandler(controller.edit));
  router.delete('/:postId', validate(postIdParamSchema, 'params'), asyncHandler(controller.remove));
  router.get('/id/:postId', validate(postIdParamSchema, 'params'), asyncHandler(controller.getById));
  router.get(
    '/user/:username',
    validate(usernameParamSchema, 'params'),
    validate(listQuerySchema, 'query'),
    asyncHandler(controller.getByUsername),
  );

  return router;
}

module.exports = { buildPostRoutes };
