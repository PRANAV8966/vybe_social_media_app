const { Router } = require('express');
const asyncHandler = require('../../middlewares/asyncHandler');
const { validate } = require('../../middlewares/validate.middleware');
const { authGuard } = require('../auth/guards/authGuard');
const { usernameParamSchema, listQuerySchema } = require('./validations/follow.validation');

function buildFollowRoutes(container) {
  const router = Router();
  const controller = container.resolve('followController');

  router.use(authGuard);

  router.post('/:username', validate(usernameParamSchema, 'params'), asyncHandler(controller.follow));
  router.delete('/:username', validate(usernameParamSchema, 'params'), asyncHandler(controller.unfollow));
  router.get('/:username/status', validate(usernameParamSchema, 'params'), asyncHandler(controller.getStatus));
  router.get(
    '/:username/followers',
    validate(usernameParamSchema, 'params'),
    validate(listQuerySchema, 'query'),
    asyncHandler(controller.getFollowers),
  );
  router.get(
    '/:username/following',
    validate(usernameParamSchema, 'params'),
    validate(listQuerySchema, 'query'),
    asyncHandler(controller.getFollowing),
  );

  return router;
}

module.exports = { buildFollowRoutes };
