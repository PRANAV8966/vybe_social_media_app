const { Follow } = require('../models/follow.model');

class FollowRepository {
  async create(followerId, followingId, session) {
    const [doc] = await Follow.create([{ follower: followerId, following: followingId }], { session });
    return doc;
  }

  /** Combined-predicate delete — returns the deleted doc, or null if the edge never existed (unfollow is idempotent). */
  deleteOne(followerId, followingId, session) {
    return Follow.findOneAndDelete({ follower: followerId, following: followingId }, { session });
  }

  async exists(followerId, followingId) {
    if (!followerId || !followingId) return false;
    const doc = await Follow.exists({ follower: followerId, following: followingId });
    return Boolean(doc);
  }

  /** Cursor pagination on _id — consistent with every other list endpoint in this codebase. */
  findFollowers(userId, { cursor, limit }) {
    const filter = { following: userId };
    if (cursor) filter._id = { $lt: cursor };
    return Follow.find(filter).sort({ _id: -1 }).limit(limit + 1).populate('follower', 'username name profilePhotoUrl isActive');
  }

  findFollowing(userId, { cursor, limit }) {
    const filter = { follower: userId };
    if (cursor) filter._id = { $lt: cursor };
    return Follow.find(filter).sort({ _id: -1 }).limit(limit + 1).populate('following', 'username name profilePhotoUrl isActive');
  }

  /** Batched membership check — e.g. "which of these userIds do I already follow" (avoids an N+1 of individual exists() calls). */
  async findFollowingAmong(followerId, candidateIds) {
    const docs = await Follow.find({ follower: followerId, following: { $in: candidateIds } }, { following: 1 });
    return new Set(docs.map((doc) => doc.following.toString()));
  }
}

module.exports = { FollowRepository };
