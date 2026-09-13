const logger = require('../../../config/logger');
const { socketAuthMiddleware } = require('./socketAuth.middleware');
const { wrapSocketHandler } = require('./wrapSocketHandler');
const { conversationRoom, userRoom } = require('./rooms');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

function isValidId(value) {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value);
}

/**
 * Never destructure a socket payload directly in a handler signature — a
 * client emitting a literal `null` (valid JSON, easy to send by accident or
 * on purpose) throws past a default-parameter guard (`= {}` only covers
 * `undefined`, not `null`), and an exception thrown synchronously inside a
 * plain `socket.on()` listener is not caught by Socket.IO/Express the way an
 * Express request handler's would be. This normalizes any payload shape to a
 * safe string-or-undefined first.
 */
function extractConversationId(payload) {
  return payload && typeof payload === 'object' ? payload.conversationId : undefined;
}

/**
 * Wires the realtime side of chat onto an existing Socket.IO server. REST
 * (chat.routes.js) remains the only path that persists anything — every
 * handler here either reads, or calls into the exact same
 * conversationService/messageService methods the REST controllers use, so
 * authorization/idempotency/validation logic lives in one place regardless
 * of which transport triggered it.
 */
function registerChatSocketHandlers(io, container) {
  const conversationService = container.resolve('conversationService');

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    socket.join(userRoom(userId));

    // Reconnect catch-up: retroactively mark anything that arrived while this
    // user was offline as delivered, and notify the senders whose ticks
    // just changed. Best-effort — a failure here never blocks the connection.
    conversationService.markUserOnline(userId).catch((err) => {
      logger.error({ err, userId }, 'markUserOnline failed');
    });

    socket.on(
      'conversation:join',
      wrapSocketHandler(socket, async ({ conversationId }) => {
        if (!isValidId(conversationId)) {
          const err = new Error('A valid conversationId is required');
          err.code = 'VALIDATION_ERROR';
          throw err;
        }
        await conversationService.authorizeParticipant(conversationId, userId);
        socket.join(conversationRoom(conversationId));
        return { conversationId };
      }),
    );

    socket.on('conversation:leave', (payload) => {
      const conversationId = extractConversationId(payload);
      if (isValidId(conversationId)) {
        socket.leave(conversationRoom(conversationId));
      }
    });

    socket.on('typing:start', (payload) => {
      const conversationId = extractConversationId(payload);
      if (isValidId(conversationId) && socket.rooms.has(conversationRoom(conversationId))) {
        socket.to(conversationRoom(conversationId)).emit('typing', { conversationId, userId, isTyping: true });
      }
    });

    socket.on('typing:stop', (payload) => {
      const conversationId = extractConversationId(payload);
      if (isValidId(conversationId) && socket.rooms.has(conversationRoom(conversationId))) {
        socket.to(conversationRoom(conversationId)).emit('typing', { conversationId, userId, isTyping: false });
      }
    });
  });
}

module.exports = { registerChatSocketHandlers };
