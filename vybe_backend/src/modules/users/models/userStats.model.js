const { Schema, model } = require('mongoose');

/**
 * Deliberately its own collection, separate from User — see phase 1 design
 * discussion: keeps the (rarely written) profile document free of
 * high-write-frequency counters, and avoids write contention on a popular
 * user's profile doc when their follower/post counts change often.
 */
const userStatsSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    followersCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    followingCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    postsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  },
);

const UserStats = model('UserStats', userStatsSchema);

module.exports = { UserStats };
