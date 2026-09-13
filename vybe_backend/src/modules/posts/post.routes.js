const { Router } = require('express');
const asyncHandler = require('../../middlewares/asyncHandler');
const { validate } = require('../../middlewares/validate.middleware');
const { authGuard } = require('../auth/guards/authGuard');
const { uploadLimiter } = require('../../middlewares/rateLimit.middleware');
const { postMediaUpload } = require('./middlewares/postMediaUpload.middleware');
const {
  createPostSchema,
  editPostSchema,
  postIdParamSchema,
  usernameParamSchema,
  listQuerySchema,
  setLikeStateSchema,
} = require('./validations/post.validation');

function buildPostRoutes(container) {
  const router = Router();
  const controller = container.resolve('postController');
  const likeController = container.resolve('likeController');

  router.use(authGuard);

  // uploadLimiter runs before multer so an over-quota request is rejected
  // before spending effort parsing/buffering its body. multer itself must
  // run before validate() — it's what populates req.body for a multipart
  // request in the first place, and req.file for the media itself.
  router.post('/', uploadLimiter, postMediaUpload, validate(createPostSchema, 'body'), asyncHandler(controller.create));
  router.patch(
    '/:postId',
    uploadLimiter,
    postMediaUpload,
    validate(postIdParamSchema, 'params'),
    validate(editPostSchema, 'body'),
    asyncHandler(controller.edit),
  );
  router.delete('/:postId', validate(postIdParamSchema, 'params'), asyncHandler(controller.remove));
  router.put(
    '/:postId/like',
    validate(postIdParamSchema, 'params'),
    validate(setLikeStateSchema, 'body'),
    asyncHandler(likeController.setLikeState),
  );
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
