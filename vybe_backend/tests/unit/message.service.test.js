const { MessageService } = require('../../src/modules/chat/services/message.service');
const { ConversationNotFoundError, NotFollowingError } = require('../../src/modules/chat/errors/chat.errors');

function makeConversation(overrides = {}) {
  return {
    _id: 'convo-1',
    participants: ['sender-1', 'peer-1'],
    participantState: [
      { user: 'sender-1', lastReadAt: null, lastDeliveredAt: null },
      { user: 'peer-1', lastReadAt: null, lastDeliveredAt: null },
    ],
    ...overrides,
  };
}

describe('MessageService.sendMessage (unit, mocked repositories/gateway)', () => {
  let messageRepository;
  let conversationRepository;
  let followRepository;
  let chatGateway;
  let service;

  beforeEach(() => {
    messageRepository = {
      findBySenderAndClientMessageId: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };
    conversationRepository = {
      findByIdForParticipant: jest.fn(),
      updatePreview: jest.fn().mockResolvedValue({}),
      advanceDeliveredWatermark: jest.fn().mockResolvedValue({}),
    };
    followRepository = { exists: jest.fn().mockResolvedValue(true) };
    chatGateway = {
      isOnline: jest.fn().mockResolvedValue(false),
      emitToConversation: jest.fn(),
      emitToUser: jest.fn(),
    };
    service = new MessageService(messageRepository, conversationRepository, followRepository, chatGateway);
  });

  it('short-circuits on a clientMessageId replay without touching the conversation, follow-check, or gateway', async () => {
    const existing = { _id: 'msg-1' };
    messageRepository.findBySenderAndClientMessageId.mockResolvedValue(existing);
    conversationRepository.findByIdForParticipant.mockResolvedValue(makeConversation());

    const result = await service.sendMessage({
      conversationId: 'convo-1',
      senderId: 'sender-1',
      content: 'hi',
      clientMessageId: 'retry-1',
    });

    expect(result.created).toBe(false);
    expect(result.message).toBe(existing);
    expect(followRepository.exists).not.toHaveBeenCalled();
    expect(chatGateway.emitToConversation).not.toHaveBeenCalled();
  });

  it('throws ConversationNotFoundError when the sender is not a participant', async () => {
    conversationRepository.findByIdForParticipant.mockResolvedValue(null);

    await expect(
      service.sendMessage({ conversationId: 'convo-1', senderId: 'sender-1', content: 'hi' }),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);
    expect(messageRepository.create).not.toHaveBeenCalled();
  });

  it('throws NotFollowingError when the sender does not currently follow the recipient', async () => {
    conversationRepository.findByIdForParticipant.mockResolvedValue(makeConversation());
    followRepository.exists.mockResolvedValue(false);

    await expect(
      service.sendMessage({ conversationId: 'convo-1', senderId: 'sender-1', content: 'hi' }),
    ).rejects.toBeInstanceOf(NotFollowingError);
    expect(messageRepository.create).not.toHaveBeenCalled();
  });

  it('recovers from a duplicate-key race on create by returning the racing message instead of throwing', async () => {
    conversationRepository.findByIdForParticipant.mockResolvedValue(makeConversation());
    const raced = { _id: 'msg-raced' };
    const dupError = Object.assign(new Error('duplicate'), { code: 11000 });
    messageRepository.create.mockRejectedValue(dupError);
    messageRepository.findBySenderAndClientMessageId
      .mockResolvedValueOnce(null) // pre-check: no existing message yet
      .mockResolvedValueOnce(raced); // post-race re-check: the concurrent insert won

    const result = await service.sendMessage({
      conversationId: 'convo-1',
      senderId: 'sender-1',
      content: 'hi',
      clientMessageId: 'racey',
    });

    expect(result.created).toBe(false);
    expect(result.message).toBe(raced);
  });

  it('propagates a non-duplicate-key error from the message insert unchanged', async () => {
    conversationRepository.findByIdForParticipant.mockResolvedValue(makeConversation());
    messageRepository.create.mockRejectedValue(new Error('connection reset'));

    await expect(
      service.sendMessage({ conversationId: 'convo-1', senderId: 'sender-1', content: 'hi' }),
    ).rejects.toThrow('connection reset');
  });

  it('does not attempt a delivery watermark advance, and reports "sent", when the peer is offline', async () => {
    conversationRepository.findByIdForParticipant.mockResolvedValue(makeConversation());
    messageRepository.create.mockResolvedValue({ _id: 'msg-1', content: 'hi', createdAt: new Date(), clientMessageId: undefined });
    chatGateway.isOnline.mockResolvedValue(false);

    const result = await service.sendMessage({ conversationId: 'convo-1', senderId: 'sender-1', content: 'hi' });

    expect(conversationRepository.advanceDeliveredWatermark).not.toHaveBeenCalled();
    expect(chatGateway.emitToConversation).not.toHaveBeenCalledWith('convo-1', 'message:status', expect.anything());
    const peerState = result.conversation.participantState.find((s) => s.user === 'peer-1');
    expect(peerState.lastDeliveredAt).toBeNull();
  });

  it('advances the delivery watermark and emits message:status when the peer is online', async () => {
    conversationRepository.findByIdForParticipant.mockResolvedValue(makeConversation());
    const createdAt = new Date();
    messageRepository.create.mockResolvedValue({ _id: 'msg-1', content: 'hi', createdAt, clientMessageId: undefined });
    chatGateway.isOnline.mockResolvedValue(true);

    const result = await service.sendMessage({ conversationId: 'convo-1', senderId: 'sender-1', content: 'hi' });

    expect(conversationRepository.advanceDeliveredWatermark).toHaveBeenCalledWith('convo-1', 'peer-1', createdAt);
    expect(chatGateway.emitToConversation).toHaveBeenCalledWith(
      'convo-1',
      'message:status',
      expect.objectContaining({ userId: 'peer-1', lastDeliveredAt: createdAt }),
    );
    const peerState = result.conversation.participantState.find((s) => s.user === 'peer-1');
    expect(peerState.lastDeliveredAt).toBe(createdAt);
  });

  it('does NOT report the message as delivered if the peer is online but the watermark DB write itself fails', async () => {
    conversationRepository.findByIdForParticipant.mockResolvedValue(makeConversation());
    const createdAt = new Date();
    messageRepository.create.mockResolvedValue({ _id: 'msg-1', content: 'hi', createdAt, clientMessageId: undefined });
    chatGateway.isOnline.mockResolvedValue(true);
    conversationRepository.advanceDeliveredWatermark.mockRejectedValue(new Error('mongo blip'));

    const result = await service.sendMessage({ conversationId: 'convo-1', senderId: 'sender-1', content: 'hi' });

    // The failure must be swallowed (never fail the send)...
    expect(result.created).toBe(true);
    // ...but the in-memory conversation handed back for the response must NOT
    // claim delivery the DB doesn't actually have, and no live status update
    // should have gone out either.
    const peerState = result.conversation.participantState.find((s) => s.user === 'peer-1');
    expect(peerState.lastDeliveredAt).toBeNull();
    expect(chatGateway.emitToConversation).not.toHaveBeenCalledWith('convo-1', 'message:status', expect.anything());
  });
});
