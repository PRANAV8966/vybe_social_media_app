class ChatError extends Error {
  constructor(code, statusCode, message, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

/**
 * Used for "conversation does not exist" AND "conversation exists but you're
 * not a participant" — deliberately ambiguous, same convention as post
 * ownership checks (never reveal more than "you can't access that").
 */
class ConversationNotFoundError extends ChatError {
  constructor() {
    super('CONVERSATION_NOT_FOUND', 404, 'Conversation not found');
  }
}

class MessageNotFoundError extends ChatError {
  constructor() {
    super('MESSAGE_NOT_FOUND', 404, 'Message not found');
  }
}

class CannotMessageSelfError extends ChatError {
  constructor() {
    super('CANNOT_MESSAGE_SELF', 400, 'You cannot start a conversation with yourself');
  }
}

/** The core gating rule: you may only message (or continue messaging) a user you currently follow. */
class NotFollowingError extends ChatError {
  constructor() {
    super('NOT_FOLLOWING', 403, 'You can only message users you follow');
  }
}

module.exports = {
  ChatError,
  ConversationNotFoundError,
  MessageNotFoundError,
  CannotMessageSelfError,
  NotFollowingError,
};
