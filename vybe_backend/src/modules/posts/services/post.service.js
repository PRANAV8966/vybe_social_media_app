const mongoose = require('mongoose');
const { PostNotFoundError } = require('../errors/post.errors');
const { UserNotFoundError } = require('../../users/errors/user.errors');

function isDuplicateKeyError(err) {
  return err && err.code === 11000;
}

class PostService {
  constructor(postRepository, userRepository, userStatsRepository, followRepository = null) {
    this.postRepository = postRepository;
    this.userRepository = userRepository;
    this.userStatsRepository = userStatsRepository;
    // Optional, wired in once the Follow module exists (phase 2) — see _isFollowing().
    this.followRepository = followRepository;
  }

  async createPost({ authorId, text, imageUrl, clientRequestId }) {
    const postData = { author: authorId, text, imageUrl: imageUrl || '', clientRequestId: clientRequestId || undefined };

    if (clientRequestId) {
      const existing = await this.postRepository.findByAuthorAndClientRequestId(authorId, clientRequestId);
      if (existing) {
        return { post: existing, created: false };
      }
    }

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
      throw err;
    } finally {
      await session.endSession();
    }

    return { post, created: true };
  }

  async editPost({ postId, authorId, text, imageUrl }) {
    const updates = {};
    if (text !== undefined) updates.text = text;
    if (imageUrl !== undefined) updates.imageUrl = imageUrl;

    const post = await this.postRepository.updateOwned(postId, authorId, updates);
    if (!post) {
      throw new PostNotFoundError();
    }
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
    const post = await this.postRepository.findVisibleById(postId);
    if (!post || !post.author || !post.author.isActive) {
      throw new PostNotFoundError();
    }

    const visibility = await this._resolveVisibility(post.author, requesterId);
    if (!visibility.canView) {
      throw new PostNotFoundError();
    }
    return post;
  }

  async getUserPosts({ username, requesterId, cursor, limit }) {
    const targetUser = await this.userRepository.findByUsername(username);
    if (!targetUser || !targetUser.isActive) {
      throw new UserNotFoundError();
    }

    const visibility = await this._resolveVisibility(targetUser, requesterId);
    if (!visibility.canView) {
      return { gated: true, isFollowing: visibility.isFollowing, posts: [], nextCursor: null };
    }

    const results = await this.postRepository.listByAuthor(targetUser._id, { cursor, limit });
    const hasMore = results.length > limit;
    const posts = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? posts[posts.length - 1]._id.toString() : null;
    return { gated: false, isFollowing: visibility.isFollowing, posts, nextCursor };
  }

  /**
   * Posts from a private account are visible only to the owner or an
   * approved follower. The Follow collection doesn't exist until phase 2, so
   * until followRepository is wired in, private accounts are visible to their
   * owner only — a safe (fail-closed) default, not a bug: nobody can be a
   * "follower" of anyone yet.
   */
  async _resolveVisibility(targetUser, requesterId) {
    const isOwner = Boolean(requesterId) && String(targetUser._id) === String(requesterId);
    if (isOwner || !targetUser.isPrivate) {
      return { canView: true, isFollowing: false };
    }
    const isFollowing = await this._isFollowing(requesterId, targetUser._id);
    return { canView: isFollowing, isFollowing };
  }

  async _isFollowing(followerId, followingId) {
    if (!this.followRepository || !followerId) {
      return false;
    }
    return this.followRepository.exists(followerId, followingId);
  }
}

module.exports = { PostService };
