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
    return Post.findOne({ _id: postId, isDeleted: false }).populate(
      'author',
      'username name profilePhotoUrl isPrivate isActive',
    );
  }

  /** Combined-predicate ownership check with no mutation — used to fail fast (and cheaply) before an expensive media upload. */
  findOwnedById(postId, authorId) {
    return Post.findOne({ _id: postId, author: authorId, isDeleted: false });
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

  /**
   * Atomic counter update, returning the post's authoritative post-update
   * count in the same round trip — callers (LikeService) need the fresh
   * value for their response and shouldn't have to re-fetch separately.
   *
   * For a negative delta, the query itself guards `likesCount > 0` — verified
   * directly (not assumed) that Mongoose's `runValidators` does NOT enforce
   * the schema's `min: 0` under a raw `$inc`: a manual test against a real
   * mongod confirmed `$inc: -1` on a likesCount of 0 happily produces -1 even
   * with `runValidators: true` set. This filter is the actual guard; the
   * schema's `min: 0` is honored on `.save()` paths only. LikeService's own
   * decrement is already only reachable after a *confirmed* Like deletion
   * (so likesCount should never legitimately be 0 there), but this makes the
   * floor a real, unconditional invariant rather than one that merely holds
   * "as long as nothing else ever goes wrong."
   */
  incrementLikesCount(postId, delta, session) {
    const filter = delta < 0 ? { _id: postId, likesCount: { $gt: 0 } } : { _id: postId };
    return Post.findOneAndUpdate({ ...filter }, { $inc: { likesCount: delta } }, { session, returnDocument: 'after' });
  }
}

module.exports = { PostRepository };
