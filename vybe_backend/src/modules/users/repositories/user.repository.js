const { User } = require('../models/user.model');

class UserRepository {
  async create(data, session) {
    const [doc] = await User.create([data], { session });
    return doc;
  }

  findById(id) {
    return User.findById(id);
  }

  findByEmail(email, { withPassword = false } = {}) {
    const query = User.findOne({ email: email.toLowerCase() });
    return withPassword ? query.select('+passwordHash') : query;
  }

  findByUsername(username) {
    return User.findOne({ username: username.toLowerCase() });
  }

  findByGoogleId(googleId) {
    return User.findOne({ googleId });
  }

  async existsByUsername(username) {
    const doc = await User.exists({ username: username.toLowerCase() });
    return Boolean(doc);
  }

  /** Combined-predicate update: a user may only ever update their own doc — id always sourced from the verified JWT, never a route param. */
  updateProfile(userId, updates) {
    return User.findOneAndUpdate({ _id: userId }, { $set: updates }, { returnDocument: 'after' });
  }

  async incrementFailedLoginAttempts(userId) {
    return User.findOneAndUpdate({ _id: userId }, { $inc: { failedLoginAttempts: 1 } }, { returnDocument: 'after' });
  }

  lockAccount(userId, lockedUntil) {
    return User.updateOne({ _id: userId }, { $set: { lockedUntil } });
  }

  resetFailedLogins(userId) {
    return User.updateOne({ _id: userId }, { $set: { failedLoginAttempts: 0, lockedUntil: null } });
  }

  /**
   * Cursor-paginated search by username prefix (uses the unique username
   * index — anchored regex can use a B-tree index) or name substring.
   * Sorted by username so the cursor (last username seen) is monotonic and
   * unambiguous, regardless of which clause matched.
   */
  async search(term, { cursor, limit }) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = {
      isActive: true,
      $or: [{ username: { $regex: `^${escaped}` } }, { name: { $regex: escaped, $options: 'i' } }],
    };
    if (cursor) {
      filter.username = { $gt: cursor };
    }
    return User.find(filter).sort({ username: 1 }).limit(limit + 1);
  }
}

module.exports = { UserRepository };
