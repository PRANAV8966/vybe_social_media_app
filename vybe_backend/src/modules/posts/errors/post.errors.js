class PostError extends Error {
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
 * Used for both "post does not exist" and "post exists but you don't own it"
 * on mutation routes — deliberately ambiguous so a request never reveals
 * more than "you can't do that", consistent with the ownership-guard design.
 */
class PostNotFoundError extends PostError {
  constructor() {
    super('POST_NOT_FOUND', 404, 'Post not found');
  }
}

class PostValidationError extends PostError {
  constructor(message, details = null) {
    super('POST_VALIDATION_ERROR', 400, message, details);
  }
}

class UnsupportedPostMediaError extends PostError {
  constructor() {
    super('UNSUPPORTED_POST_MEDIA', 400, 'Unsupported or unrecognized media format');
  }
}

class PostMediaTooLargeError extends PostError {
  constructor(mediaType, maxBytes) {
    super('POST_MEDIA_TOO_LARGE', 400, `${mediaType === 'video' ? 'Video' : 'Image'} exceeds the ${maxBytes}-byte limit`);
  }
}

module.exports = { PostError, PostNotFoundError, PostValidationError, UnsupportedPostMediaError, PostMediaTooLargeError };
