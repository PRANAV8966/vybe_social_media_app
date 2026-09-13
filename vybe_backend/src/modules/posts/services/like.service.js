const mongoose = require('mongoose');
const { resolveVisibility } = require('../utils/postVisibility');
const { PostNotFoundError } = require('../errors/post.errors');

function isDuplicateKeyError(err) {
  return err && err.code === 11000;
}

class LikeService {
  constructor(likeRepository, postRepository, followRepository) {
    this.likeRepository = likeRepository;
    this.postRepository = postRepository;
    this.followRepository = followRepository;
  }

  /**
   * Idempotent "set my like state" — PUT semantics, not a toggle: calling
   * this twice with the same `liked` value is a safe no-op (a toggle would
   * flip state on a client retry after a timeout, silently losing intent).
   */
  async setLikeState({ postId, userId, liked }) {
    const [post, alreadyLiked] = await Promise.all([
      this.postRepository.findVisibleById(postId),
      this.likeRepository.exists(userId, postId),
    ]);

    if (!post || !post.author || !post.author.isActive) {
      throw new PostNotFoundError();
    }

    const visibility = await resolveVisibility(this.followRepository, post.author, userId);
    if (!visibility.canView) {
      // Never reveal that a post exists behind a private account you can't
      // see — same ambiguous 404 every other post route uses.
      throw new PostNotFoundError();
    }

    if (alreadyLiked === liked) {
      return { liked, likesCount: post.likesCount };
    }

    let likesCount = null; // stays null unless OUR write is the one that actually changed the count

    if (liked) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await this.likeRepository.create(userId, postId, session);
          const updated = await this.postRepository.incrementLikesCount(postId, 1, session);
          likesCount = updated.likesCount;
        });
      } catch (err) {
        if (!isDuplicateKeyError(err)) throw err;
        // Lost a race with a concurrent identical like — already recorded by the other request.
      } finally {
        await session.endSession();
      }
    } else {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const deleted = await this.likeRepository.deleteOne(userId, postId, session);
          if (deleted) {
            // incrementLikesCount's own query guards likesCount > 0 for a
            // negative delta (see post.repository.js) — `updated` can come
            // back null if the counter was already at 0 despite a Like row
            // existing (a data-inconsistency edge case, not the normal path).
            // Floor at 0 rather than crash on a null dereference.
            const updated = await this.postRepository.incrementLikesCount(postId, -1, session);
            likesCount = updated ? updated.likesCount : 0;
          }
          // deleted === null means someone else's concurrent unlike already removed it — no-op for us.
        });
      } finally {
        await session.endSession();
      }
    }

    if (likesCount === null) {
      // Our write was a no-op (race already resolved by a concurrent request) —
      // return the current authoritative count rather than the stale pre-call one.
      const current = await this.postRepository.findVisibleById(postId);
      likesCount = current ? current.likesCount : post.likesCount;
    }

    return { liked, likesCount };
  }
}

module.exports = { LikeService };
