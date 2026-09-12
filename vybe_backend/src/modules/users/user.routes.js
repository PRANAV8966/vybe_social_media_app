const { Router } = require('express');
const asyncHandler = require('../../middlewares/asyncHandler');
const { validate } = require('../../middlewares/validate.middleware');
const { authGuard } = require('../auth/guards/authGuard');
const { usernameParamSchema, updateProfileSchema, searchQuerySchema } = require('./validations/user.validation');

function buildUserRoutes(container) {
  const router = Router();
  const controller = container.resolve('userController');

  router.get('/me', authGuard, asyncHandler(controller.getMe));
  router.patch('/me', authGuard, validate(updateProfileSchema, 'body'), asyncHandler(controller.updateMe));
  router.get('/search', authGuard, validate(searchQuerySchema, 'query'), asyncHandler(controller.search));
  router.get('/:username', authGuard, validate(usernameParamSchema, 'params'), asyncHandler(controller.getByUsername));

  return router;
}

module.exports = { buildUserRoutes };
