const { Post } = require('../models/post.model');

class PostRepository {
  /**
   * Plain insert when no clientRequestId is supplied. When one is supplied,
   * the caller is expected to have already handled the duplicate-key race
   * (see PostService.createPost) — this method itself stays a thin wrapper
   * so the idempotency decision logic lives in one place (the service).
   */
  async create(data, session) {
    const [doc] = await Post.create([data], { session });
    return doc;
  }

  findByAuthorAndClientRequestId(authorId, clientRequestId) {
    return Post.findOne({ author: authorId, clientRequestId });
  }

  findVisibleById(postId) {
    return Post.findOne({ _id: postId, isDeleted: false }).populate('author', 'username name avatarUrl isPrivate isActive');
  }

  /** Combined-predicate: a mutation only ever succeeds if the caller owns the post. Returns null for "not found or not yours" — deliberately ambiguous. */
  updateOwned(postId, authorId, updates) {
    return Post.findOneAndUpdate(
      { _id: postId, author: authorId, isDeleted: false },
      { $set: { ...updates, editedAt: new Date() } },
      { returnDocument: 'after' },
    );
  }

  softDeleteOwned(postId, authorId, session) {
    return Post.findOneAndUpdate(
      { _id: postId, author: authorId, isDeleted: false },
      { $set: { isDeleted: true } },
      { session, returnDocument: 'after' },
    );
  }

  /** Cursor pagination on _id (monotonic, unique) — simple and correct for a reverse-chronological timeline. */
  async listByAuthor(authorId, { cursor, limit }) {
    const filter = { author: authorId, isDeleted: false };
    if (cursor) {
      filter._id = { $lt: cursor };
    }
    return Post.find(filter).sort({ _id: -1 }).limit(limit + 1);
  }
}

module.exports = { PostRepository };
