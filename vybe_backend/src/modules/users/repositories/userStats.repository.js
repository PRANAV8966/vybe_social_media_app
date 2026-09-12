const { UserStats } = require('../models/userStats.model');

class UserStatsRepository {
  async createForUser(userId, session) {
    const [doc] = await UserStats.create([{ user: userId }], { session });
    return doc;
  }

  findByUserId(userId) {
    return UserStats.findOne({ user: userId });
  }

  async findByUserIds(userIds) {
    return UserStats.find({ user: { $in: userIds } });
  }

  incrementPostsCount(userId, delta, session) {
    return UserStats.updateOne({ user: userId }, { $inc: { postsCount: delta } }, { session });
  }

  incrementFollowersCount(userId, delta, session) {
    return UserStats.updateOne({ user: userId }, { $inc: { followersCount: delta } }, { session });
  }

  incrementFollowingCount(userId, delta, session) {
    return UserStats.updateOne({ user: userId }, { $inc: { followingCount: delta } }, { session });
  }
}

module.exports = { UserStatsRepository };
