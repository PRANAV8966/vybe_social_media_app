const { Message } = require('../models/message.model');

class MessageRepository {
  async create(data, session) {
    const [doc] = await Message.create([data], { session });
    return doc;
  }

  findBySenderAndClientMessageId(conversationId, senderId, clientMessageId) {
    return Message.findOne({ conversation: conversationId, sender: senderId, clientMessageId });
  }

  findByIdInConversation(messageId, conversationId) {
    return Message.findOne({ _id: messageId, conversation: conversationId });
  }

  /** Cursor pagination on _id (newest-first) — identical convention to Post.listByAuthor. */
  async listByConversation(conversationId, { cursor, limit }) {
    const filter = { conversation: conversationId };
    if (cursor) {
      filter._id = { $lt: cursor };
    }
    return Message.find(filter).sort({ _id: -1 }).limit(limit + 1);
  }
}

module.exports = { MessageRepository };
