const { UserNotFoundError } = require('../errors/user.errors');

const EDITABLE_PROFILE_FIELDS = ['name', 'bio', 'country', 'isPrivate'];

class UserService {
  constructor(userRepository, userStatsRepository, profilePhotoStorage) {
    this.userRepository = userRepository;
    this.userStatsRepository = userStatsRepository;
    this.profilePhotoStorage = profilePhotoStorage;
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

  /**
   * Upload-and-commit ordering matters here (see phase-2 design discussion):
   * 1. upload the NEW photo and confirm it succeeded
   * 2. save the new URL — this is the moment the pointer flips, and the only
   *    safe commit point
   * 3. best-effort delete the OLD photo, only now that nothing references it
   * Never parallelize steps 1-2: a failed upload racing a successful DB write
   * would leave the profile pointing at a photo that doesn't exist.
   */
  async updateProfilePhoto(userId, file) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new UserNotFoundError();
    }

    const detected = this.profilePhotoStorage.validate(file.buffer);
    const newUrl = await this.profilePhotoStorage.upload(userId, file.buffer, detected);

    const updated = await this.userRepository.updateProfile(userId, { profilePhotoUrl: newUrl });
    if (!updated) {
      await this.profilePhotoStorage.deleteByUrl(newUrl);
      throw new UserNotFoundError();
    }

    if (user.profilePhotoUrl) {
      await this.profilePhotoStorage.deleteByUrl(user.profilePhotoUrl);
    }

    const stats = await this.userStatsRepository.findByUserId(userId);
    return { user: updated, stats };
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
