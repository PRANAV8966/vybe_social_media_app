const { buildCanonicalKey } = require('../utils/canonicalKey');
const { ConversationNotFoundError, MessageNotFoundError, CannotMessageSelfError, NotFollowingError } = require('../errors/chat.errors');
const { UserNotFoundError } = require('../../users/errors/user.errors');

function isDuplicateKeyError(err) {
  return err && err.code === 11000;
}

function participantIdOf(participant) {
  return String(participant && participant._id ? participant._id : participant);
}

function otherParticipantId(conversation, viewerId) {
  const other = conversation.participants.find((p) => participantIdOf(p) !== String(viewerId));
  return other ? participantIdOf(other) : null;
}

class ConversationService {
  constructor(conversationRepository, messageRepository, userRepository, followRepository, chatGateway) {
    this.conversationRepository = conversationRepository;
    this.messageRepository = messageRepository;
    this.userRepository = userRepository;
    // Hard dependency, unlike posts' optional wiring — chat cannot correctly
    // enforce "only message users you follow" without a real Follow module.
    this.followRepository = followRepository;
    this.chatGateway = chatGateway;
  }

  async startConversation({ actorId, targetUsername }) {
    const target = await this.userRepository.findByUsername(targetUsername);
    if (!target || !target.isActive) {
      throw new UserNotFoundError();
    }
    if (String(target._id) === String(actorId)) {
      throw new CannotMessageSelfError();
    }

    const isFollowing = await this.followRepository.exists(actorId, target._id);
    if (!isFollowing) {
      throw new NotFollowingError();
    }

    const canonicalKey = buildCanonicalKey(actorId, target._id);
    const existing = await this.conversationRepository.findByCanonicalKey(canonicalKey);
    if (existing) {
      return { conversation: existing, created: false };
    }

    try {
      const conversation = await this.conversationRepository.create({
        participants: [actorId, target._id],
        canonicalKey,
        participantState: [
          { user: actorId, lastReadAt: null, lastDeliveredAt: null },
          { user: target._id, lastReadAt: null, lastDeliveredAt: null },
        ],
      });
      const hydrated = await this.conversationRepository.findByCanonicalKey(canonicalKey);
      this.chatGateway.emitToUser(target._id, 'conversation:new', { conversationId: conversation._id.toString() });
      return { conversation: hydrated, created: true };
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        // Lost a race with a concurrent "start chat" from either side.
        const raced = await this.conversationRepository.findByCanonicalKey(canonicalKey);
        if (raced) return { conversation: raced, created: false };
      }
      throw err;
    }
  }

  /** Combined-predicate authorization check used by both REST controllers and the socket 'conversation:join' handler. */
  async authorizeParticipant(conversationId, userId) {
    const conversation = await this.conversationRepository.findByIdForParticipant(conversationId, userId);
    if (!conversation) {
      throw new ConversationNotFoundError();
    }
    return conversation;
  }

  async listConversations({ userId, cursor, limit }) {
    const results = await this.conversationRepository.listByUser(userId, { cursor, limit });
    const hasMore = results.length > limit;
    const page = hasMore ? results.slice(0, limit) : results;
    return { conversations: page, nextCursor: hasMore ? page[page.length - 1] : null };
  }

  async listMessages({ conversationId, userId, cursor, limit }) {
    const conversation = await this.authorizeParticipant(conversationId, userId);
    const results = await this.messageRepository.listByConversation(conversationId, { cursor, limit });
    const hasMore = results.length > limit;
    const page = hasMore ? results.slice(0, limit) : results;
    return { conversation, messages: page, nextCursor: hasMore ? page[page.length - 1]._id.toString() : null };
  }

  async markRead({ conversationId, userId, lastReadMessageId }) {
    const conversation = await this.authorizeParticipant(conversationId, userId);
    const targetMessage = await this.messageRepository.findByIdInConversation(lastReadMessageId, conversationId);
    if (!targetMessage) {
      throw new MessageNotFoundError();
    }

    await this.conversationRepository.advanceReadWatermark(conversationId, userId, targetMessage.createdAt);
    this.chatGateway.emitToConversation(conversationId, 'message:status', {
      conversationId,
      userId: String(userId),
      lastReadAt: targetMessage.createdAt,
      lastDeliveredAt: targetMessage.createdAt,
    });

    return conversation;
  }

  /**
   * Called once per socket connection. Retroactively advances this user's
   * delivery watermark for every conversation where someone else sent the
   * last message — messages that arrived while they had no active socket
   * are only now "delivered". Best-effort real-time notification to the
   * affected senders; the REST layer remains correct regardless of whether
   * this succeeds (a sender who never gets the live update still sees the
   * right tick the next time they fetch).
   */
  async markUserOnline(userId) {
    const candidates = await this.conversationRepository.findLastMessageNotFromUser(userId);
    const now = new Date();
    const pending = candidates.filter((conversation) => {
      const state = (conversation.participantState || []).find((s) => String(s.user) === String(userId));
      return !state || !state.lastDeliveredAt || state.lastDeliveredAt < conversation.lastMessageAt;
    });

    if (pending.length === 0) return;

    await this.conversationRepository.bulkAdvanceDelivered(
      pending.map((c) => c._id),
      userId,
      now,
    );

    for (const conversation of pending) {
      this.chatGateway.emitToConversation(conversation._id.toString(), 'message:status', {
        conversationId: conversation._id.toString(),
        userId: String(userId),
        lastDeliveredAt: now,
      });
    }
  }
}

module.exports = { ConversationService, otherParticipantId };
