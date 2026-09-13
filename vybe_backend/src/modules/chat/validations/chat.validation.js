const Joi = require('joi');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const CLIENT_MESSAGE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;
// Conversation-list cursors are opaque base64url blobs (see conversationCursor.js), not raw ObjectIds.
const OPAQUE_CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,500}$/;

const objectIdParam = Joi.string().pattern(OBJECT_ID_PATTERN).required();

const startConversationSchema = Joi.object({
  username: Joi.string().trim().lowercase().pattern(/^[a-z0-9_.]{3,30}$/).required(),
});

const conversationIdParamSchema = Joi.object({
  conversationId: objectIdParam,
});

const sendMessageSchema = Joi.object({
  content: Joi.string().trim().min(1).max(4096).required(),
  clientMessageId: Joi.string().trim().pattern(CLIENT_MESSAGE_ID_PATTERN),
});

const markReadSchema = Joi.object({
  lastReadMessageId: objectIdParam,
});

const conversationListQuerySchema = Joi.object({
  cursor: Joi.string().pattern(OPAQUE_CURSOR_PATTERN),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

const messageListQuerySchema = Joi.object({
  cursor: Joi.string().pattern(OBJECT_ID_PATTERN),
  limit: Joi.number().integer().min(1).max(100).default(30),
});

module.exports = {
  startConversationSchema,
  conversationIdParamSchema,
  sendMessageSchema,
  markReadSchema,
  conversationListQuerySchema,
  messageListQuerySchema,
};
