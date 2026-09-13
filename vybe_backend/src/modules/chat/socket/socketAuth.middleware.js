const { verifyAccessToken } = require('../../auth/utils/jwt.util');

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
    return next(new Error('MISSING_ACCESS_TOKEN'));
  }

  try {
    const payload = verifyAccessToken(token);
    socket.data.userId = payload.sub;
    next();
  } catch {
    next(new Error('INVALID_ACCESS_TOKEN'));
  }
}

module.exports = { socketAuthMiddleware };
