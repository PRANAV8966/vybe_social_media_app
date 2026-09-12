class AuthError extends Error {
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

/** Deliberately generic — never reveals whether the email exists or the password was wrong. */
class InvalidCredentialsError extends AuthError {
  constructor() {
    super('INVALID_CREDENTIALS', 401, 'Invalid email or password');
  }
}

class AccountLockedError extends AuthError {
  constructor(lockedUntil) {
    super('ACCOUNT_LOCKED', 423, 'Too many failed login attempts. Please try again later.', { lockedUntil });
  }
}

class EmailAlreadyExistsError extends AuthError {
  constructor() {
    super('EMAIL_ALREADY_EXISTS', 409, 'An account with this email already exists');
  }
}

class UsernameAlreadyExistsError extends AuthError {
  constructor() {
    super('USERNAME_ALREADY_EXISTS', 409, 'That username is already taken');
  }
}

class InvalidRefreshTokenError extends AuthError {
  constructor() {
    super('INVALID_REFRESH_TOKEN', 401, 'Invalid or expired session, please log in again');
  }
}

class MissingAccessTokenError extends AuthError {
  constructor() {
    super('MISSING_ACCESS_TOKEN', 401, 'Authentication required');
  }
}

class InvalidAccessTokenError extends AuthError {
  constructor() {
    super('INVALID_ACCESS_TOKEN', 401, 'Invalid or expired access token');
  }
}

class GoogleAuthError extends AuthError {
  constructor(message = 'Google authentication failed') {
    super('GOOGLE_AUTH_FAILED', 401, message);
  }
}

class UsernameAllocationError extends AuthError {
  constructor() {
    super('USERNAME_ALLOCATION_FAILED', 500, 'Could not create an account right now, please try again');
  }
}

module.exports = {
  AuthError,
  InvalidCredentialsError,
  AccountLockedError,
  EmailAlreadyExistsError,
  UsernameAlreadyExistsError,
  InvalidRefreshTokenError,
  MissingAccessTokenError,
  InvalidAccessTokenError,
  GoogleAuthError,
  UsernameAllocationError,
};
