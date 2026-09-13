const logger = require('../../../config/logger');
const { NotFollowingError, ConversationNotFoundError } = require('../errors/chat.errors');
const { otherParticipantId } = require('./conversation.service');

function isDuplicateKeyError(err) {
  return err && err.code === 11000;
}

function logAndSwallow(context) {
  return (err) => logger.error({ err }, context);
}

class MessageService {
  constructor(messageRepository, conversationRepository, followRepository, chatGateway) {
    this.messageRepository = messageRepository;
    this.conversationRepository = conversationRepository;
    this.followRepository = followRepository;
    this.chatGateway = chatGateway;
  }

  async sendMessage({ conversationId, senderId, content, clientMessageId }) {
    if (clientMessageId) {
      const existing = await this.messageRepository.findBySenderAndClientMessageId(conversationId, senderId, clientMessageId);
      if (existing) {
        const conversation = await this.conversationRepository.findByIdForParticipant(conversationId, senderId);
        return { message: existing, conversation, created: false };
      }
    }

    // authorizeParticipant-equivalent inline (needs the raw conversation to find the peer) —
    // kept here rather than delegated to avoid a second round trip for the same document.
    const conversation = await this.conversationRepository.findByIdForParticipant(conversationId, senderId);
    if (!conversation) {
      throw new ConversationNotFoundError();
    }

    const peerId = otherParticipantId(conversation, senderId);
    const isFollowing = await this.followRepository.exists(senderId, peerId);
    if (!isFollowing) {
      throw new NotFollowingError();
    }

    let message;
    try {
      message = await this.messageRepository.create({
        conversation: conversationId,
        sender: senderId,
        content,
        clientMessageId: clientMessageId || undefined,
      });
    } catch (err) {
      if (isDuplicateKeyError(err) && clientMessageId) {
        // Lost a race with a concurrent identical send (e.g. a client retry after a timeout).
        const raced = await this.messageRepository.findBySenderAndClientMessageId(conversationId, senderId, clientMessageId);
        if (raced) return { message: raced, conversation, created: false };
      }
      throw err;
    }

    // Everything below is best-effort and decoupled from the critical write
    // above on purpose (see the production-scaling review): a delayed
    // preview or a missed live delivery tick is acceptable, a blocked
    // message send is not — so none of this can fail the request.
    const isPeerOnline = await this.chatGateway.isOnline(peerId).catch(() => false);
    const [, deliveredUpdate] = await Promise.all([
      this.conversationRepository
        .updatePreview(conversationId, { text: content, at: message.createdAt, by: senderId })
        .catch(logAndSwallow('chat: failed to update conversation preview')),
      isPeerOnline
        ? this.conversationRepository
            .advanceDeliveredWatermark(conversationId, peerId, message.createdAt)
            .catch(logAndSwallow('chat: failed to advance delivery watermark'))
        : Promise.resolve(null),
    ]);

    this.chatGateway.emitToConversation(conversationId, 'message:new', {
      message: {
        id: message._id.toString(),
        conversation: conversationId,
        sender: String(senderId),
        content: message.content,
        clientMessageId: message.clientMessageId || null,
        createdAt: message.createdAt,
      },
    });
    this.chatGateway.emitToUser(peerId, 'conversation:updated', {
      conversationId,
      lastMessageText: content,
      lastMessageAt: message.createdAt,
      lastMessageBy: String(senderId),
    });
    if (isPeerOnline && deliveredUpdate) {
      this.chatGateway.emitToConversation(conversationId, 'message:status', {
        conversationId,
        userId: String(peerId),
        lastDeliveredAt: message.createdAt,
      });
    }

    conversation.lastMessageText = content;
    conversation.lastMessageAt = message.createdAt;
    conversation.lastMessageBy = senderId;
    if (isPeerOnline) {
      const peerState = conversation.participantState.find((s) => String(s.user) === String(peerId));
      if (peerState) peerState.lastDeliveredAt = message.createdAt;
    }

    return { message, conversation, created: true };
  }
}

module.exports = { MessageService };
