const crypto = require('crypto');
const mongoose = require('mongoose');
const env = require('../../../config/env');
const { hashPassword, verifyPassword } = require('../utils/password.util');
const {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiryDate,
} = require('../utils/jwt.util');
const {
  InvalidCredentialsError,
  AccountLockedError,
  EmailAlreadyExistsError,
  UsernameAlreadyExistsError,
  InvalidRefreshTokenError,
  GoogleAuthError,
  UsernameAllocationError,
} = require('../errors/auth.errors');

const USERNAME_ALLOCATION_ATTEMPTS = 5;

function isDuplicateKeyError(err) {
  return err && err.code === 11000;
}

function slugifyUsername(input) {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, '')
    .slice(0, 20);
  return base.length >= 3 ? base : `user${crypto.randomInt(1000, 9999)}`;
}

class AuthService {
  constructor(userRepository, userStatsRepository, refreshTokenRepository, googleVerifier) {
    this.userRepository = userRepository;
    this.userStatsRepository = userStatsRepository;
    this.refreshTokenRepository = refreshTokenRepository;
    this.googleVerifier = googleVerifier;
  }

  async register({ name, username, email, password, country }, meta = {}) {
    const passwordHash = await hashPassword(password);
    const session = await mongoose.startSession();
    let user;
    try {
      await session.withTransaction(async () => {
        try {
          user = await this.userRepository.create(
            { name, username, email, passwordHash, authProvider: 'local', country: country || null },
            session,
          );
        } catch (err) {
          if (isDuplicateKeyError(err)) {
            if (err.keyPattern?.email) throw new EmailAlreadyExistsError();
            if (err.keyPattern?.username) throw new UsernameAlreadyExistsError();
          }
          throw err;
        }
        await this.userStatsRepository.createForUser(user._id, session);
      });
    } finally {
      await session.endSession();
    }

    const tokens = await this._issueTokenPair(user._id, meta);
    return { user, tokens };
  }

  async login({ email, password }, meta = {}) {
    const user = await this.userRepository.findByEmail(email, { withPassword: true });
    if (!user || user.authProvider !== 'local' || !user.isActive) {
      throw new InvalidCredentialsError();
    }
    const lockExpired = user.lockedUntil && user.lockedUntil.getTime() <= Date.now();
    if (user.lockedUntil && !lockExpired) {
      throw new AccountLockedError(user.lockedUntil);
    }

    const passwordValid = await verifyPassword(user.passwordHash, password);
    if (!passwordValid) {
      // A lock that has already expired grants a fresh attempt budget rather
      // than immediately re-locking on the stale pre-expiry count.
      if (lockExpired) {
        await this.userRepository.resetFailedLogins(user._id);
      }
      const updated = await this.userRepository.incrementFailedLoginAttempts(user._id);
      if (updated.failedLoginAttempts >= env.login.maxFailedAttempts) {
        await this.userRepository.lockAccount(user._id, new Date(Date.now() + env.login.lockDurationMs));
      }
      throw new InvalidCredentialsError();
    }

    await this.userRepository.resetFailedLogins(user._id);
    const tokens = await this._issueTokenPair(user._id, meta);
    return { user, tokens };
  }

  async loginWithGoogle(idToken, meta = {}) {
    let profile;
    try {
      profile = await this.googleVerifier.verify(idToken);
    } catch {
      throw new GoogleAuthError('Invalid Google token');
    }
    if (!profile.emailVerified) {
      throw new GoogleAuthError('Google account email is not verified');
    }

    let user = await this.userRepository.findByGoogleId(profile.googleId);
    if (!user) {
      // Deliberately NOT auto-linking to an existing local account that
      // happens to share this email: phase 1 has no email-ownership
      // verification on local registration, so an attacker could register
      // first with the victim's email and silently inherit access once the
      // real owner later signs in with Google. Account linking must instead
      // be an explicit, authenticated action (out of scope for phase 1) —
      // never inferred from an email match during login.
      const existingByEmail = await this.userRepository.findByEmail(profile.email);
      if (existingByEmail) {
        throw new GoogleAuthError('An account with this email already exists. Please log in with your password instead.');
      }
      user = await this._createGoogleUser(profile);
    }

    const tokens = await this._issueTokenPair(user._id, meta);
    return { user, tokens };
  }

  async _createGoogleUser(profile) {
    const baseUsername = slugifyUsername(profile.name || profile.email.split('@')[0]);

    for (let attempt = 0; attempt < USERNAME_ALLOCATION_ATTEMPTS; attempt += 1) {
      const candidate = attempt === 0 ? baseUsername : `${baseUsername}${crypto.randomInt(1000, 9999)}`;
      const session = await mongoose.startSession();
      try {
        let user;
        await session.withTransaction(async () => {
          user = await this.userRepository.create(
            {
              name: profile.name,
              username: candidate,
              email: profile.email,
              authProvider: 'google',
              googleId: profile.googleId,
              profilePhotoUrl: profile.profilePhotoUrl,
            },
            session,
          );
          await this.userStatsRepository.createForUser(user._id, session);
        });
        return user;
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          if (err.keyPattern?.username) {
            continue; // expected collision — retry with a new candidate
          }
          // googleId or email already exists: a concurrent request beat us to creating this
          // exact account. Not a real conflict — fetch and return what's already there.
          // eslint-disable-next-line no-await-in-loop
          const existing = (await this.userRepository.findByGoogleId(profile.googleId)) ?? (await this.userRepository.findByEmail(profile.email));
          if (existing) return existing;
        }
        throw err;
      } finally {
        // eslint-disable-next-line no-await-in-loop
        await session.endSession();
      }
    }

    throw new UsernameAllocationError();
  }

  async refresh(rawRefreshToken) {
    if (!rawRefreshToken) {
      throw new InvalidRefreshTokenError();
    }

    const hash = hashRefreshToken(rawRefreshToken);
    const tokenDoc = await this.refreshTokenRepository.findByHash(hash);
    if (!tokenDoc) {
      throw new InvalidRefreshTokenError();
    }

    if (tokenDoc.revokedAt || tokenDoc.expiresAt.getTime() <= Date.now()) {
      // Reuse of an already-rotated (or expired) token is treated as possible
      // theft — burn every active token for this user, forcing re-login
      // everywhere, per OWASP refresh-token-rotation guidance.
      await this.refreshTokenRepository.revokeAllForUser(tokenDoc.user);
      throw new InvalidRefreshTokenError();
    }

    const { raw: newRaw, hash: newHash } = generateRefreshToken();
    const session = await mongoose.startSession();
    let rotationSucceeded = false;
    try {
      await session.withTransaction(async () => {
        const consumed = await this.refreshTokenRepository.consume(tokenDoc._id, newHash, session);
        if (!consumed) {
          return; // concurrent request already rotated this token — handled below, outside the txn
        }
        await this.refreshTokenRepository.create(
          { user: tokenDoc.user, tokenHash: newHash, expiresAt: refreshTokenExpiryDate() },
          session,
        );
        rotationSucceeded = true;
      });
    } finally {
      await session.endSession();
    }

    if (!rotationSucceeded) {
      await this.refreshTokenRepository.revokeAllForUser(tokenDoc.user);
      throw new InvalidRefreshTokenError();
    }

    const accessToken = signAccessToken(tokenDoc.user);
    return { userId: tokenDoc.user, accessToken, refreshToken: newRaw };
  }

  async logout(rawRefreshToken) {
    if (!rawRefreshToken) {
      return;
    }
    const hash = hashRefreshToken(rawRefreshToken);
    await this.refreshTokenRepository.revokeByHash(hash);
  }

  async _issueTokenPair(userId, meta = {}) {
    const accessToken = signAccessToken(userId);
    const { raw, hash } = generateRefreshToken();
    await this.refreshTokenRepository.create({
      user: userId,
      tokenHash: hash,
      expiresAt: refreshTokenExpiryDate(),
      userAgent: meta.userAgent || null,
      ip: meta.ip || null,
    });
    return { accessToken, refreshToken: raw };
  }
}

module.exports = { AuthService };
