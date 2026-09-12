const { Schema, model } = require('mongoose');

const postSchema = new Schema(
  {
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    imageUrl: {
      type: String,
      default: '',
    },
    likesCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
      default: null,
    },
    /** Optional client-supplied idempotency key — see the partial index below. */
    clientRequestId: {
      type: String,
      default: undefined,
    },
  },
  { timestamps: true },
);

postSchema.index({ author: 1, createdAt: -1 });

// A plain `sparse: true` compound index would NOT do what we want here: MongoDB
// includes a document in a sparse compound index as long as it has a value for
// AT LEAST ONE of the indexed fields — since `author` is always present, every
// post would still be indexed, and two posts from the same author that both
// omit clientRequestId would collide on `{author, clientRequestId: null}`.
// A partial index restricted to documents where clientRequestId actually
// exists is what gives us "idempotent only when the client opts in".
postSchema.index(
  { author: 1, clientRequestId: 1 },
  { unique: true, partialFilterExpression: { clientRequestId: { $exists: true } } },
);

const Post = model('Post', postSchema);

module.exports = { Post };
