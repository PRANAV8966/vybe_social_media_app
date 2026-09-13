class FollowError extends Error {
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

class CannotFollowSelfError extends FollowError {
  constructor() {
    super('CANNOT_FOLLOW_SELF', 400, 'You cannot follow yourself');
  }
}

module.exports = { FollowError, CannotFollowSelfError };
