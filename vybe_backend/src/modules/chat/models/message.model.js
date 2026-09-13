const { Schema, model } = require('mongoose');

const messageSchema = new Schema(
  {
    conversation: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
    },
    sender: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4096,
    },
    /** Optional client-supplied idempotency key — see the partial index below. */
    clientMessageId: {
      type: String,
      default: undefined,
    },
  },
  { timestamps: true },
);

// History pagination: newest-first cursor on _id within a conversation.
messageSchema.index({ conversation: 1, _id: -1 });

// Same partial-index technique as Post.clientRequestId — a plain sparse
// compound index would NOT give "unique only when the client opts in" (see
// post.model.js for the full explanation); a partial index restricted to
// documents where clientMessageId actually exists does.
messageSchema.index(
  { conversation: 1, sender: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $exists: true } } },
);

const Message = model('Message', messageSchema);

module.exports = { Message };
