const { ConversationRepository } = require('./repositories/conversation.repository');
const { MessageRepository } = require('./repositories/message.repository');
const { ConversationService } = require('./services/conversation.service');
const { MessageService } = require('./services/message.service');
const { ChatController } = require('./controllers/chat.controller');
const { ChatGateway } = require('./socket/chatGateway');

/**
 * Requires the Follow module to already be registered in the container —
 * unlike posts' optional/graceful-degrade wiring, chat has no safe fallback
 * for "no follow data available": the entire feature's core rule (you can
 * only message users you follow) depends on it. Registration order between
 * follow and chat doesn't matter (container resolution is lazy), but both
 * must be registered before the app's routes are built.
 */
function registerChatModule(container) {
  container.registerSingleton('chatGateway', () => new ChatGateway());
  container.registerSingleton('conversationRepository', () => new ConversationRepository());
  container.registerSingleton('messageRepository', () => new MessageRepository());
  container.registerSingleton(
    'conversationService',
    (c) =>
      new ConversationService(
        c.resolve('conversationRepository'),
        c.resolve('messageRepository'),
        c.resolve('userRepository'),
        c.resolve('followRepository'),
        c.resolve('chatGateway'),
      ),
  );
  container.registerSingleton(
    'messageService',
    (c) =>
      new MessageService(
        c.resolve('messageRepository'),
        c.resolve('conversationRepository'),
        c.resolve('followRepository'),
        c.resolve('chatGateway'),
      ),
  );
  container.registerSingleton(
    'chatController',
    (c) => new ChatController(c.resolve('conversationService'), c.resolve('messageService')),
  );
}

module.exports = { registerChatModule };
