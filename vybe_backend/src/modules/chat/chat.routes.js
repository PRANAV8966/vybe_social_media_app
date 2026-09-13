const { Router } = require('express');
const asyncHandler = require('../../middlewares/asyncHandler');
const { validate } = require('../../middlewares/validate.middleware');
const { authGuard } = require('../auth/guards/authGuard');
const { chatMessageLimiter } = require('../../middlewares/rateLimit.middleware');
const {
  startConversationSchema,
  conversationIdParamSchema,
  sendMessageSchema,
  markReadSchema,
  conversationListQuerySchema,
  messageListQuerySchema,
} = require('./validations/chat.validation');

function buildChatRoutes(container) {
  const router = Router();
  const controller = container.resolve('chatController');

  router.use(authGuard);

  router.post('/conversations', validate(startConversationSchema, 'body'), asyncHandler(controller.startConversation));
  router.get('/conversations', validate(conversationListQuerySchema, 'query'), asyncHandler(controller.listConversations));
  router.get(
    '/conversations/:conversationId/messages',
    validate(conversationIdParamSchema, 'params'),
    validate(messageListQuerySchema, 'query'),
    asyncHandler(controller.listMessages),
  );
  router.post(
    '/conversations/:conversationId/messages',
    chatMessageLimiter,
    validate(conversationIdParamSchema, 'params'),
    validate(sendMessageSchema, 'body'),
    asyncHandler(controller.sendMessage),
  );
  router.post(
    '/conversations/:conversationId/read',
    validate(conversationIdParamSchema, 'params'),
    validate(markReadSchema, 'body'),
    asyncHandler(controller.markRead),
  );

  return router;
}

module.exports = { buildChatRoutes };
