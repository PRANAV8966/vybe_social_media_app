const chatResponse = require('../dto/responses/chat.response');
const { encodeConversationCursor } = require('../utils/conversationCursor');

class ChatController {
  constructor(conversationService, messageService) {
    this.conversationService = conversationService;
    this.messageService = messageService;

    this.startConversation = this.startConversation.bind(this);
    this.listConversations = this.listConversations.bind(this);
    this.listMessages = this.listMessages.bind(this);
    this.sendMessage = this.sendMessage.bind(this);
    this.markRead = this.markRead.bind(this);
  }

  async startConversation(req, res) {
    const { conversation, created } = await this.conversationService.startConversation({
      actorId: req.user.id,
      targetUsername: req.body.username,
    });
    res
      .status(created ? 201 : 200)
      .json(chatResponse.success(chatResponse.toConversationDTO(conversation, req.user.id), created ? 'Conversation started' : 'Conversation already exists'));
  }

  async listConversations(req, res) {
    const { cursor, limit } = req.query;
    const { conversations, nextCursor } = await this.conversationService.listConversations({
      userId: req.user.id,
      cursor: cursor || null,
      limit,
    });
    res.status(200).json(
      chatResponse.success({
        conversations: conversations.map((c) => chatResponse.toConversationDTO(c, req.user.id)),
        nextCursor: nextCursor ? encodeConversationCursor(nextCursor) : null,
      }),
    );
  }

  async listMessages(req, res) {
    const { cursor, limit } = req.query;
    const { conversation, messages, nextCursor } = await this.conversationService.listMessages({
      conversationId: req.params.conversationId,
      userId: req.user.id,
      cursor: cursor || null,
      limit,
    });
    res.status(200).json(
      chatResponse.success({
        messages: messages.map((m) => chatResponse.toMessageDTO(m, conversation)),
        nextCursor,
      }),
    );
  }

  async sendMessage(req, res) {
    const { message, conversation, created } = await this.messageService.sendMessage({
      conversationId: req.params.conversationId,
      senderId: req.user.id,
      content: req.body.content,
      clientMessageId: req.body.clientMessageId,
    });
    res
      .status(created ? 201 : 200)
      .json(chatResponse.success(chatResponse.toMessageDTO(message, conversation), created ? 'Message sent' : 'Message already sent'));
  }

  async markRead(req, res) {
    await this.conversationService.markRead({
      conversationId: req.params.conversationId,
      userId: req.user.id,
      lastReadMessageId: req.body.lastReadMessageId,
    });
    res.status(200).json(chatResponse.success(null, 'Marked as read'));
  }
}

module.exports = { ChatController };
