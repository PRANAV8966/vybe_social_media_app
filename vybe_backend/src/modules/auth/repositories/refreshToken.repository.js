const { RefreshToken } = require('../models/refreshToken.model');

class RefreshTokenRepository {
  create(data, session) {
    return RefreshToken.create([data], { session }).then(([doc]) => doc);
  }

  findByHash(tokenHash) {
    return RefreshToken.findOne({ tokenHash });
  }

  /**
   * Atomically "consumes" a still-valid token as part of rotation. Returns
   * null if it was already revoked/consumed by a concurrent request — the
   * caller treats that as reuse, not a race to retry.
   */
  consume(tokenId, replacedByTokenHash, session) {
    return RefreshToken.findOneAndUpdate(
      { _id: tokenId, revokedAt: null },
      { $set: { revokedAt: new Date(), replacedByTokenHash } },
      { session, returnDocument: 'after' },
    );
  }

  revokeByHash(tokenHash) {
    return RefreshToken.updateOne({ tokenHash, revokedAt: null }, { $set: { revokedAt: new Date() } });
  }

  /** Reuse-detection response: burn every active token for this user, forcing re-login everywhere. */
  revokeAllForUser(userId) {
    return RefreshToken.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  }
}

module.exports = { RefreshTokenRepository };
