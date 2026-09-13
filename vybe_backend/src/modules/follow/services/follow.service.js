const mongoose = require('mongoose');
const { CannotFollowSelfError } = require('../errors/follow.errors');
const { UserNotFoundError } = require('../../users/errors/user.errors');

function isDuplicateKeyError(err) {
  return err && err.code === 11000;
}

class FollowService {
  constructor(followRepository, userRepository, userStatsRepository) {
    this.followRepository = followRepository;
    this.userRepository = userRepository;
    this.userStatsRepository = userStatsRepository;
  }

  async _resolveTarget(targetUsername) {
    const target = await this.userRepository.findByUsername(targetUsername);
    if (!target || !target.isActive) {
      throw new UserNotFoundError();
    }
    return target;
  }

  /**
   * Idempotent: following someone you already follow is a no-op success, not
   * a conflict — a double-tap on the follow button shouldn't error.
   */
  async follow(followerId, targetUsername) {
    const target = await this._resolveTarget(targetUsername);
    if (String(target._id) === String(followerId)) {
      throw new CannotFollowSelfError();
    }

    const alreadyFollowing = await this.followRepository.exists(followerId, target._id);
    if (alreadyFollowing) {
      return { following: true, targetId: target._id.toString() };
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await this.followRepository.create(followerId, target._id, session);
        await Promise.all([
          this.userStatsRepository.incrementFollowersCount(target._id, 1, session),
          this.userStatsRepository.incrementFollowingCount(followerId, 1, session),
        ]);
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        // Lost a race with a concurrent identical follow request — the edge
        // already exists, so the end state is exactly what was asked for.
        return { following: true, targetId: target._id.toString() };
      }
      throw err;
    } finally {
      await session.endSession();
    }

    return { following: true, targetId: target._id.toString() };
  }

  /** Idempotent: unfollowing someone you don't follow is a no-op success. */
  async unfollow(followerId, targetUsername) {
    const target = await this._resolveTarget(targetUsername);

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const deleted = await this.followRepository.deleteOne(followerId, target._id, session);
        if (deleted) {
          await Promise.all([
            this.userStatsRepository.incrementFollowersCount(target._id, -1, session),
            this.userStatsRepository.incrementFollowingCount(followerId, -1, session),
          ]);
        }
      });
    } finally {
      await session.endSession();
    }

    return { following: false, targetId: target._id.toString() };
  }

  async getStatus(followerId, targetUsername) {
    const target = await this._resolveTarget(targetUsername);
    const following = await this.followRepository.exists(followerId, target._id);
    return { following };
  }

  async getFollowers(targetUsername, { cursor, limit }) {
    const target = await this._resolveTarget(targetUsername);
    const results = await this.followRepository.findFollowers(target._id, { cursor, limit });
    const hasMore = results.length > limit;
    const page = hasMore ? results.slice(0, limit) : results;
    return {
      users: page.map((doc) => doc.follower),
      nextCursor: hasMore ? page[page.length - 1]._id.toString() : null,
    };
  }

  async getFollowing(targetUsername, { cursor, limit }) {
    const target = await this._resolveTarget(targetUsername);
    const results = await this.followRepository.findFollowing(target._id, { cursor, limit });
    const hasMore = results.length > limit;
    const page = hasMore ? results.slice(0, limit) : results;
    return {
      users: page.map((doc) => doc.following),
      nextCursor: hasMore ? page[page.length - 1]._id.toString() : null,
    };
  }
}

module.exports = { FollowService };
