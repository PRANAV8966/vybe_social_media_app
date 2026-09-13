const { Conversation } = require('../models/conversation.model');
const { decodeConversationCursor } = require('../utils/conversationCursor');

const PARTICIPANT_PROJECTION = 'username name profilePhotoUrl isActive';

class ConversationRepository {
  create(data, session) {
    return Conversation.create([data], { session }).then(([doc]) => doc);
  }

  findByCanonicalKey(canonicalKey) {
    return Conversation.findOne({ canonicalKey }).populate('participants', PARTICIPANT_PROJECTION);
  }

  /** Combined-predicate: only ever resolves if the caller is actually a participant. Returns null for "not found or not yours" — deliberately ambiguous, same convention as post ownership checks. */
  findByIdForParticipant(conversationId, userId) {
    return Conversation.findOne({ _id: conversationId, participants: userId }).populate('participants', PARTICIPANT_PROJECTION);
  }

  /** Cursor pagination on (lastMessageAt desc, _id desc) — most-recently-active conversation first, matching every chat app's inbox ordering. */
  async listByUser(userId, { cursor, limit }) {
    const filter = { participants: userId };
    if (cursor) {
      const decoded = decodeConversationCursor(cursor);
      if (decoded) {
        const { a, i } = decoded;
        if (a === null) {
          filter._id = { $lt: i };
          filter.lastMessageAt = null;
        } else {
          filter.$or = [
            { lastMessageAt: { $lt: new Date(a) } },
            { lastMessageAt: new Date(a), _id: { $lt: i } },
            { lastMessageAt: null },
          ];
        }
      }
    }
    return Conversation.find(filter)
      .sort({ lastMessageAt: -1, _id: -1 })
      .limit(limit + 1)
      .populate('participants', PARTICIPANT_PROJECTION);
  }

  updatePreview(conversationId, { text, at, by }) {
    return Conversation.updateOne(
      { _id: conversationId },
      { $set: { lastMessageText: text, lastMessageAt: at, lastMessageBy: by } },
    );
  }

  /** Guarded, monotonic — never rewinds a watermark that's already ahead (e.g. an out-of-order retry). Reading implies delivered, so both watermarks advance together. */
  advanceReadWatermark(conversationId, userId, when) {
    return Conversation.updateOne(
      { _id: conversationId, 'participantState.user': userId },
      {
        $max: {
          'participantState.$[elem].lastReadAt': when,
          'participantState.$[elem].lastDeliveredAt': when,
        },
      },
      { arrayFilters: [{ 'elem.user': userId }] },
    );
  }

  advanceDeliveredWatermark(conversationId, userId, when) {
    return Conversation.updateOne(
      { _id: conversationId, 'participantState.user': userId },
      { $max: { 'participantState.$[elem].lastDeliveredAt': when } },
      { arrayFilters: [{ 'elem.user': userId }] },
    );
  }

  /**
   * Reconnect catch-up candidates: conversations where `userId` is a
   * participant and did NOT send the last message — i.e. conversations that
   * *might* have a message newer than their delivery watermark. Whether each
   * one actually is behind is cheap to finish checking in JS (see
   * ConversationService.markUserOnline) rather than expressing an
   * array-element-vs-sibling-field comparison as a query — this only runs
   * once per connect, never on the message-send hot path, so a plain find
   * plus an in-memory filter is the simpler and equally correct choice here.
   */
  findLastMessageNotFromUser(userId) {
    return Conversation.find({
      participants: userId,
      lastMessageAt: { $ne: null },
      lastMessageBy: { $ne: userId },
    }).select('_id participantState lastMessageAt');
  }

  bulkAdvanceDelivered(conversationIds, userId, when) {
    if (conversationIds.length === 0) return Promise.resolve({ modifiedCount: 0 });
    return Conversation.updateMany(
      { _id: { $in: conversationIds } },
      { $max: { 'participantState.$[elem].lastDeliveredAt': when } },
      { arrayFilters: [{ 'elem.user': userId }] },
    );
  }
}

module.exports = { ConversationRepository };
