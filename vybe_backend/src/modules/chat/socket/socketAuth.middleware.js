const { verifyAccessToken } = require('../../auth/utils/jwt.util');

/**
 * Socket.IO forwards a connection-middleware error's `.data` straight through
 * to the client's `connect_error` event (alongside `.message`) — so this
 * carries the same {code, message} shape as every REST error envelope in the
 * app, rather than a client having to parse an ad-hoc string.
 */
function authError(code, message) {
  const err = new Error(message);
  err.data = { code, message };
  return err;
}

/**
 * Socket.IO handshake auth — same access token, same verification logic as
 * authGuard, just adapted to the handshake `auth` payload instead of an
 * Authorization header (there is no header-equivalent concept for the
 * initial WebSocket/polling handshake). This is the same one deliberate
 * cross-module dependency on the auth module that authGuard already is,
 * extended to a second transport.
 */
function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token || typeof token !== 'string') {
    return next(authError('MISSING_ACCESS_TOKEN', 'An access token is required to connect'));
  }

  try {
    const payload = verifyAccessToken(token);
    socket.data.userId = payload.sub;
    next();
  } catch {
    next(authError('INVALID_ACCESS_TOKEN', 'The access token is invalid or expired'));
  }
}

module.exports = { socketAuthMiddleware };
