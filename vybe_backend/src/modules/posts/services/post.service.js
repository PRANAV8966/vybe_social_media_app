const mongoose = require('mongoose');
const { PostNotFoundError, PostValidationError } = require('../errors/post.errors');
const { UserNotFoundError } = require('../../users/errors/user.errors');
const { resolveVisibility } = require('../utils/postVisibility');

function isDuplicateKeyError(err) {
  return err && err.code === 11000;
}

class PostService {
  constructor(postRepository, userRepository, userStatsRepository, postMediaStorage, followRepository = null, likeRepository = null) {
    this.postRepository = postRepository;
    this.userRepository = userRepository;
    this.userStatsRepository = userStatsRepository;
    this.postMediaStorage = postMediaStorage;
    // Optional, wired in once the Follow module exists (phase 2) — see postVisibility.js.
    this.followRepository = followRepository;
    // Optional too, same reasoning — without it, isLiked simply stays undefined on every post.
    this.likeRepository = likeRepository;
  }

  /**
   * `file` is the raw multer upload (req.file), optional. Media is uploaded
   * to S3 BEFORE the post is created — only a confirmed upload is ever
   * referenced by the DB (see phase-2 design discussion on safe ordering).
   */
  async createPost({ authorId, text, clientRequestId, file }) {
    if (clientRequestId) {
      const existing = await this.postRepository.findByAuthorAndClientRequestId(authorId, clientRequestId);
      if (existing) {
        // A genuine replay never re-uploads — avoids both wasted storage and
        // the (client-bug-only) risk of silently overwriting the original
        // media with different bytes under the same key. The replayed post
        // may have accumulated likes since its original creation (self-likes
        // are allowed), so this is worth a real lookup, not an assumed false.
        existing.isLiked = await this._isLikedBy(authorId, existing._id);
        return { post: existing, created: false };
      }
    }

    let mediaUrl = null;
    let mediaType = null;
    if (file) {
      const detected = this.postMediaStorage.validate(file.buffer, file.mimetype);
      mediaUrl = await this.postMediaStorage.upload({
        authorId,
        buffer: file.buffer,
        ext: detected.ext,
        contentType: detected.contentType,
        clientRequestId,
      });
      mediaType = detected.mediaType;
    }

    const postData = { author: authorId, text, mediaUrl, mediaType, clientRequestId: clientRequestId || undefined };

    const session = await mongoose.startSession();
    let post;
    try {
      await session.withTransaction(async () => {
        post = await this.postRepository.create(postData, session);
        await this.userStatsRepository.incrementPostsCount(authorId, 1, session);
      });
    } catch (err) {
      if (isDuplicateKeyError(err) && clientRequestId) {
        // Lost a race with a concurrent identical request submitted between our pre-check and the insert.
        const existing = await this.postRepository.findByAuthorAndClientRequestId(authorId, clientRequestId);
        if (existing) {
          return { post: existing, created: false };
        }
      }
      if (mediaUrl) {
        await this.postMediaStorage.deleteByUrl(mediaUrl); // avoid orphaning the upload we just made
      }
      throw err;
    } finally {
      await session.endSession();
    }

    // A post that was just inserted in this same call cannot already have a
    // like on it — no query needed to know that with certainty.
    post.isLiked = this.likeRepository ? false : undefined;
    return { post, created: true };
  }

  async editPost({ postId, authorId, text, file }) {
    if (text === undefined && !file) {
      throw new PostValidationError('Provide text and/or media to update');
    }

    const existing = await this.postRepository.findOwnedById(postId, authorId);
    if (!existing) {
      // Fail fast and cheap — never spend an upload on a post the caller doesn't own.
      throw new PostNotFoundError();
    }

    const updates = {};
    if (text !== undefined) updates.text = text;

    if (file) {
      const detected = this.postMediaStorage.validate(file.buffer, file.mimetype);
      updates.mediaUrl = await this.postMediaStorage.upload({
        authorId,
        buffer: file.buffer,
        ext: detected.ext,
        contentType: detected.contentType,
      });
      updates.mediaType = detected.mediaType;
    }

    const post = await this.postRepository.updateOwned(postId, authorId, updates);
    if (!post) {
      // Lost a race (e.g. concurrently deleted) between our ownership check and the update.
      if (updates.mediaUrl) {
        await this.postMediaStorage.deleteByUrl(updates.mediaUrl);
      }
      throw new PostNotFoundError();
    }

    if (updates.mediaUrl && existing.mediaUrl) {
      // Only now that the new URL is safely committed is it safe to remove the old one.
      await this.postMediaStorage.deleteByUrl(existing.mediaUrl);
    }

    // Self-likes are allowed, so an edited post may already carry one from
    // its author — compute it for real rather than assuming false.
    post.isLiked = await this._isLikedBy(authorId, post._id);
    return post;
  }

  async deletePost({ postId, authorId }) {
    const session = await mongoose.startSession();
    let post;
    try {
      await session.withTransaction(async () => {
        post = await this.postRepository.softDeleteOwned(postId, authorId, session);
        if (!post) {
          throw new PostNotFoundError();
        }
        await this.userStatsRepository.incrementPostsCount(authorId, -1, session);
      });
    } finally {
      await session.endSession();
    }
    return post;
  }

  async getPostById({ postId, requesterId }) {
    // Independent reads — likeRepository.exists() doesn't depend on the
    // visibility check's outcome, and its result is simply discarded if the
    // post turns out not to be visible (never exposed to the caller either way).
    const [post, isLiked] = await Promise.all([
      this.postRepository.findVisibleById(postId),
      this._isLikedBy(requesterId, postId),
    ]);
    if (!post || !post.author || !post.author.isActive) {
      throw new PostNotFoundError();
    }

    const visibility = await resolveVisibility(this.followRepository, post.author, requesterId);
    if (!visibility.canView) {
      throw new PostNotFoundError();
    }
    post.isLiked = isLiked;
    return post;
  }

  async getUserPosts({ username, requesterId, cursor, limit }) {
    const targetUser = await this.userRepository.findByUsername(username);
    if (!targetUser || !targetUser.isActive) {
      throw new UserNotFoundError();
    }

    const visibility = await resolveVisibility(this.followRepository, targetUser, requesterId);
    if (!visibility.canView) {
      return { gated: true, isFollowing: visibility.isFollowing, posts: [], nextCursor: null };
    }

    const results = await this.postRepository.listByAuthor(targetUser._id, { cursor, limit });
    const hasMore = results.length > limit;
    const posts = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? posts[posts.length - 1]._id.toString() : null;

    if (this.likeRepository && requesterId && posts.length > 0) {
      const likedSet = await this.likeRepository.findLikedAmong(
        requesterId,
        posts.map((p) => p._id),
      );
      posts.forEach((p) => {
        p.isLiked = likedSet.has(p._id.toString());
      });
    }

    return { gated: false, isFollowing: visibility.isFollowing, posts, nextCursor };
  }

  async _isLikedBy(userId, postId) {
    if (!this.likeRepository || !userId) {
      return undefined;
    }
    return this.likeRepository.exists(userId, postId);
  }
}

module.exports = { PostService };
