class UserError extends Error {
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

class UserNotFoundError extends UserError {
  constructor() {
    super('USER_NOT_FOUND', 404, 'User not found');
  }
}

module.exports = { UserError, UserNotFoundError };
