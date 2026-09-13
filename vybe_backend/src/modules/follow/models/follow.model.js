const { Schema, model } = require('mongoose');

const followSchema = new Schema(
  {
    follower: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    following: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true },
);

// Primary uniqueness guard — one follow edge per (follower, following) pair,
// and the index MongoDB itself uses to answer "does A follow B" in O(log n).
followSchema.index({ follower: 1, following: 1 }, { unique: true });
// Reverse lookup — "who follows this user" (followers list) and the
// isFollowing check used from the peer's side.
followSchema.index({ following: 1, follower: 1 });

const Follow = model('Follow', followSchema);

module.exports = { Follow };
