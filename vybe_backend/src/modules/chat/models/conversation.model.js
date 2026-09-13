const { Schema, model } = require('mongoose');

const participantStateSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Watermarks, not per-message flags: a message's tick state is computed
    // at read time as `message.createdAt <= peer.lastReadAt/lastDeliveredAt`.
    // One tiny guarded ($max) update per event instead of bulk-writing every
    // message row every time someone opens a chat or comes back online.
    lastReadAt: { type: Date, default: null },
    lastDeliveredAt: { type: Date, default: null },
  },
  { _id: false },
);

const conversationSchema = new Schema(
  {
    // Exactly 2 for now — no group chat. Enforced in ConversationService, not
    // the schema, since "exactly 2" is a business rule, not a structural one.
    participants: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
    // sha256 of the two participant ids, sorted — makes "find or create the
    // direct conversation between A and B" a single unique-indexed upsert,
    // race-safe against two concurrent "start chat" taps from either side.
    canonicalKey: { type: String, required: true, unique: true },
    lastMessageText: { type: String, default: null },
    lastMessageAt: { type: Date, default: null },
    lastMessageBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    participantState: [participantStateSchema],
  },
  { timestamps: true },
);

// "All conversations I'm part of" — participants is a multikey index.
conversationSchema.index({ participants: 1 });

const Conversation = model('Conversation', conversationSchema);

module.exports = { Conversation };
