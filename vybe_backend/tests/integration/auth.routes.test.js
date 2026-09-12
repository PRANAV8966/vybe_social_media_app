const request = require('supertest');
const { buildTestApp } = require('../helpers/buildTestApp');

function validRegisterPayload(overrides = {}) {
  return {
    name: 'Ada Lovelace',
    username: 'ada',
    email: 'ada@example.com',
    password: 'correct-horse-battery-staple',
    ...overrides,
  };
}

/** Pulls just the `refreshToken=...` cookie header (with attributes) out of a response, for reuse on the next request. */
function extractRefreshCookieHeader(res) {
  const setCookie = res.headers['set-cookie'] || [];
  const found = setCookie.find((c) => c.startsWith('refreshToken='));
  if (!found) return null;
  return found.split(';')[0]; // "refreshToken=<value>"
}

describe('Auth routes', () => {
  describe('POST /api/v1/auth/register', () => {
    it('registers a new user and returns an access token + refresh cookie', async () => {
      const { app } = buildTestApp();
      const res = await request(app).post('/api/v1/auth/register').send(validRegisterPayload());

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('ada@example.com');
      expect(res.body.data.user.passwordHash).toBeUndefined();
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      expect(extractRefreshCookieHeader(res)).toEqual(expect.any(String));
    });

    it('rejects a duplicate email with 409 EMAIL_ALREADY_EXISTS', async () => {
      const { app } = buildTestApp();
      await request(app).post('/api/v1/auth/register').send(validRegisterPayload());
      const res = await request(app).post('/api/v1/auth/register').send(validRegisterPayload({ username: 'ada2' }));

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
    });

    it('rejects a duplicate username with 409 USERNAME_ALREADY_EXISTS', async () => {
      const { app } = buildTestApp();
      await request(app).post('/api/v1/auth/register').send(validRegisterPayload());
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(validRegisterPayload({ email: 'someone-else@example.com' }));

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('USERNAME_ALREADY_EXISTS');
    });

    it('rejects a short password with a 400 validation error', async () => {
      const { app } = buildTestApp();
      const res = await request(app).post('/api/v1/auth/register').send(validRegisterPayload({ password: 'short' }));

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('logs in with correct credentials', async () => {
      const { app } = buildTestApp();
      await request(app).post('/api/v1/auth/register').send(validRegisterPayload());

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'ada@example.com', password: 'correct-horse-battery-staple' });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toEqual(expect.any(String));
    });

    it('rejects a wrong password and an unknown email with the same generic message (no user enumeration)', async () => {
      const { app } = buildTestApp();
      await request(app).post('/api/v1/auth/register').send(validRegisterPayload());

      const wrongPassword = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'ada@example.com', password: 'totally-wrong-password' });
      const unknownEmail = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'totally-wrong-password' });

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
    });

    it('locks the account after the configured number of failed attempts', async () => {
      const { app } = buildTestApp(); // test env: LOGIN_MAX_FAILED_ATTEMPTS=3
      await request(app).post('/api/v1/auth/register').send(validRegisterPayload());

      for (let i = 0; i < 3; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await request(app).post('/api/v1/auth/login').send({ email: 'ada@example.com', password: 'wrong' });
      }

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'ada@example.com', password: 'correct-horse-battery-staple' });

      expect(res.status).toBe(423);
      expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('rotates the refresh token and issues a new access token', async () => {
      const { app } = buildTestApp();
      const registerRes = await request(app).post('/api/v1/auth/register').send(validRegisterPayload());
      const cookie1 = extractRefreshCookieHeader(registerRes);

      const first = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie1);
      expect(first.status).toBe(200);
      expect(first.body.data.accessToken).toEqual(expect.any(String));

      const cookie2 = extractRefreshCookieHeader(first);
      expect(cookie2).not.toBe(cookie1);

      const second = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie2);
      expect(second.status).toBe(200);
    });

    it('detects reuse of an already-rotated refresh token and revokes the whole session family', async () => {
      const { app } = buildTestApp();
      const registerRes = await request(app).post('/api/v1/auth/register').send(validRegisterPayload());
      const originalCookie = extractRefreshCookieHeader(registerRes);

      const firstRefresh = await request(app).post('/api/v1/auth/refresh').set('Cookie', originalCookie);
      expect(firstRefresh.status).toBe(200);
      const rotatedCookie = extractRefreshCookieHeader(firstRefresh);

      // Replay the ORIGINAL (now-rotated-away) refresh cookie.
      const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', originalCookie);
      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe('INVALID_REFRESH_TOKEN');

      // The whole family is burned — even the token from the legitimate first
      // refresh must no longer work.
      const afterReuse = await request(app).post('/api/v1/auth/refresh').set('Cookie', rotatedCookie);
      expect(afterReuse.status).toBe(401);
    });

    it('rejects a refresh call with no cookie at all', async () => {
      const { app } = buildTestApp();
      const res = await request(app).post('/api/v1/auth/refresh');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('revokes the refresh token so it can no longer be used', async () => {
      const { app } = buildTestApp();
      const registerRes = await request(app).post('/api/v1/auth/register').send(validRegisterPayload());
      const cookie = extractRefreshCookieHeader(registerRes);

      const logoutRes = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie);
      expect(logoutRes.status).toBe(200);

      const afterLogout = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
      expect(afterLogout.status).toBe(401);
    });

    it('is idempotent when called with no session', async () => {
      const { app } = buildTestApp();
      const res = await request(app).post('/api/v1/auth/logout');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/auth/google', () => {
    function fakeVerifier(profile) {
      return { verify: jest.fn().mockResolvedValue(profile) };
    }

    it('creates a new account for a first-time Google sign-in', async () => {
      const { app } = buildTestApp({
        googleVerifier: fakeVerifier({
          googleId: 'g-123',
          email: 'newgoogle@example.com',
          emailVerified: true,
          name: 'Grace Hopper',
          avatarUrl: 'https://example.com/pic.png',
        }),
      });

      const res = await request(app).post('/api/v1/auth/google').send({ idToken: 'fake-token' });

      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe('newgoogle@example.com');
      expect(res.body.data.user.authProvider).toBe('google');
    });

    it('logs an existing Google user back in on a second sign-in (idempotent, not a duplicate account)', async () => {
      const verifier = fakeVerifier({
        googleId: 'g-456',
        email: 'repeat@example.com',
        emailVerified: true,
        name: 'Repeat User',
        avatarUrl: '',
      });
      const { app } = buildTestApp({ googleVerifier: verifier });

      const first = await request(app).post('/api/v1/auth/google').send({ idToken: 'fake-token' });
      const second = await request(app).post('/api/v1/auth/google').send({ idToken: 'fake-token' });

      expect(first.body.data.user.id).toBe(second.body.data.user.id);
    });

    it('refuses to silently link a Google sign-in to an existing local account with the same email (would let whoever registered first keep access)', async () => {
      const { app } = buildTestApp({
        googleVerifier: fakeVerifier({
          googleId: 'g-789',
          email: 'ada@example.com',
          emailVerified: true,
          name: 'Ada Lovelace',
          avatarUrl: '',
        }),
      });

      await request(app).post('/api/v1/auth/register').send(validRegisterPayload());
      const res = await request(app).post('/api/v1/auth/google').send({ idToken: 'fake-token' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('GOOGLE_AUTH_FAILED');
    });

    it('rejects a Google token whose email is not verified', async () => {
      const { app } = buildTestApp({
        googleVerifier: fakeVerifier({
          googleId: 'g-999',
          email: 'unverified@example.com',
          emailVerified: false,
          name: 'Unverified',
          avatarUrl: '',
        }),
      });

      const res = await request(app).post('/api/v1/auth/google').send({ idToken: 'fake-token' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('GOOGLE_AUTH_FAILED');
    });
  });
});
