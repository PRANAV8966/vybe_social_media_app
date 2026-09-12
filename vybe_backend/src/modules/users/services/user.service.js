const { UserNotFoundError } = require('../errors/user.errors');

const EDITABLE_PROFILE_FIELDS = ['name', 'bio', 'avatarUrl', 'country', 'isPrivate'];

class UserService {
  constructor(userRepository, userStatsRepository) {
    this.userRepository = userRepository;
    this.userStatsRepository = userStatsRepository;
  }

  /** Own profile: userId is already known from the verified access token, so both reads fire in parallel. */
  async getMyProfile(userId) {
    const [user, stats] = await Promise.all([
      this.userRepository.findById(userId),
      this.userStatsRepository.findByUserId(userId),
    ]);
    if (!user) {
      throw new UserNotFoundError();
    }
    return { user, stats };
  }

  /** Public profile by username: username -> id must resolve first, so stats fetch can't start until then. */
  async getPublicProfile(username) {
    const user = await this.userRepository.findByUsername(username);
    if (!user || !user.isActive) {
      throw new UserNotFoundError();
    }
    const stats = await this.userStatsRepository.findByUserId(user._id);
    return { user, stats };
  }

  async updateProfile(userId, updates) {
    const sanitized = {};
    for (const field of EDITABLE_PROFILE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(updates, field)) {
        sanitized[field] = updates[field];
      }
    }
    const user = await this.userRepository.updateProfile(userId, sanitized);
    if (!user) {
      throw new UserNotFoundError();
    }
    const stats = await this.userStatsRepository.findByUserId(userId);
    return { user, stats };
  }

  async search(term, { cursor, limit }) {
    const results = await this.userRepository.search(term, { cursor, limit });
    const hasMore = results.length > limit;
    const page = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? page[page.length - 1].username : null;

    const statsDocs = await this.userStatsRepository.findByUserIds(page.map((u) => u._id));
    const statsByUserId = new Map(statsDocs.map((s) => [s.user.toString(), s]));
    const users = page.map((user) => ({ user, stats: statsByUserId.get(user._id.toString()) ?? null }));

    return { users, nextCursor };
  }
}

module.exports = { UserService, EDITABLE_PROFILE_FIELDS };
