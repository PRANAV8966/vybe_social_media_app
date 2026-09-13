const { Schema, model } = require('mongoose');

const likeSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    post: {
      type: Schema.Types.ObjectId,
      ref: 'Post',
      required: true,
    },
  },
  { timestamps: true },
);

// Primary uniqueness guard — one like per (user, post) pair, and the index
// used to answer "has this user liked this post" in O(log n).
likeSchema.index({ user: 1, post: 1 }, { unique: true });
// Reverse lookup / batched membership checks ("which of these posts has this
// user liked") — see LikeRepository.findLikedAmong.
likeSchema.index({ post: 1, user: 1 });

const Like = model('Like', likeSchema);

module.exports = { Like };
