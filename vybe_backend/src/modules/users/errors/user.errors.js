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

class InvalidProfilePhotoError extends UserError {
  constructor(message = 'Unsupported or unrecognized image format') {
    super('INVALID_PROFILE_PHOTO', 400, message);
  }
}

class ProfilePhotoTooLargeError extends UserError {
  constructor(maxBytes) {
    super('PROFILE_PHOTO_TOO_LARGE', 400, `Profile photo exceeds the ${maxBytes}-byte limit`);
  }
}

module.exports = { UserError, UserNotFoundError, InvalidProfilePhotoError, ProfilePhotoTooLargeError };
