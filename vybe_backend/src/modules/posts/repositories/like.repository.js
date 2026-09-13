const { Like } = require('../models/like.model');

class LikeRepository {
  async create(userId, postId, session) {
    const [doc] = await Like.create([{ user: userId, post: postId }], { session });
    return doc;
  }

  /** Combined-predicate delete — returns the deleted doc, or null if the like never existed (unlike is idempotent). */
  deleteOne(userId, postId, session) {
    return Like.findOneAndDelete({ user: userId, post: postId }, { session });
  }

  async exists(userId, postId) {
    if (!userId || !postId) return false;
    const doc = await Like.exists({ user: userId, post: postId });
    return Boolean(doc);
  }

  /** Batched membership check — "which of these postIds has this user liked" in one query, avoiding an N+1 across a post list/feed. */
  async findLikedAmong(userId, postIds) {
    if (!userId || postIds.length === 0) return new Set();
    const docs = await Like.find({ user: userId, post: { $in: postIds } }, { post: 1 });
    return new Set(docs.map((doc) => doc.post.toString()));
  }
}

module.exports = { LikeRepository };
