const { Router } = require('express');
const asyncHandler = require('../../middlewares/asyncHandler');
const { validate } = require('../../middlewares/validate.middleware');
const { authLimiter } = require('../../middlewares/rateLimit.middleware');
const { registerSchema, loginSchema, googleAuthSchema, refreshTokenSchema, logoutSchema } = require('./validations/auth.validation');

function buildAuthRoutes(container) {
  const router = Router();
  const controller = container.resolve('authController');

  router.post('/register', authLimiter, validate(registerSchema, 'body'), asyncHandler(controller.register));
  router.post('/login', authLimiter, validate(loginSchema, 'body'), asyncHandler(controller.login));
  router.post('/google', authLimiter, validate(googleAuthSchema, 'body'), asyncHandler(controller.google));
  router.post('/refresh', authLimiter, validate(refreshTokenSchema, 'body'), asyncHandler(controller.refresh));
  router.post('/logout', validate(logoutSchema, 'body'), asyncHandler(controller.logout));

  return router;
}

module.exports = { buildAuthRoutes };
