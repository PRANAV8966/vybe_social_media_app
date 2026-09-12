const { verifyAccessToken } = require('../utils/jwt.util');
const { MissingAccessTokenError, InvalidAccessTokenError } = require('../errors/auth.errors');

/**
 * Verifies the access token and sets req.user. Owned by the auth module but
 * imported directly by every other module's routes to protect their
 * endpoints — the one deliberate cross-module dependency in this codebase,
 * since auth is the sole owner of tokens/secrets.
 */
function authGuard(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new MissingAccessTokenError());
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    return next(new MissingAccessTokenError());
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub };
    next();
  } catch {
    next(new InvalidAccessTokenError());
  }
}

module.exports = { authGuard };
