const logger = require('../../../config/logger');
const { ChatError } = require('../errors/chat.errors');

/**
 * Socket equivalent of asyncHandler/the REST error handlers: catches a
 * rejected promise and turns it into a consistent, precise error payload
 * instead of crashing the connection or failing silently. Uses the client's
 * ack callback when one was provided (request/response style), falling back
 * to a generic 'error' event otherwise — either way the shape matches the
 * REST error envelope's duck-typed {code, message} convention.
 */
function wrapSocketHandler(socket, handler) {
  return async function wrapped(payload, ack) {
    try {
      const result = await handler(payload || {});
      if (typeof ack === 'function') {
        ack({ success: true, data: result === undefined ? null : result });
      }
    } catch (err) {
      const isKnown = err instanceof ChatError || typeof err.statusCode === 'number';
      if (!isKnown) {
        logger.error({ err }, 'Unhandled chat socket error');
      } else {
        logger.warn({ err: { name: err.name, message: err.message } }, 'Chat socket request error');
      }

      const errorPayload = { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Something went wrong' };
      if (typeof ack === 'function') {
        ack({ success: false, error: errorPayload });
      } else {
        socket.emit('error', errorPayload);
      }
    }
  };
}

module.exports = { wrapSocketHandler };
