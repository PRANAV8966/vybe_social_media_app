const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const ms = require('ms');
const env = require('../../../config/env');

function signAccessToken(userId) {
  return jwt.sign({}, env.jwt.accessSecret, {
    subject: userId.toString(),
    expiresIn: env.jwt.accessExpiresIn,
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  });
}

/** @throws {jsonwebtoken.JsonWebTokenError|jsonwebtoken.TokenExpiredError} */
function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret, {
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  });
}

/** Opaque, high-entropy refresh token — not a JWT. Only its sha256 hash is ever persisted. */
function generateRefreshToken() {
  const raw = crypto.randomBytes(64).toString('hex');
  return { raw, hash: hashRefreshToken(raw) };
}

function hashRefreshToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function refreshTokenExpiryDate() {
  return new Date(Date.now() + ms(env.jwt.refreshExpiresIn));
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiryDate,
};
