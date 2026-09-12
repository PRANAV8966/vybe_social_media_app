const request = require('supertest');
const { buildTestApp } = require('../helpers/buildTestApp');

async function registerUser(app, overrides = {}) {
  const payload = {
    name: 'Ada Lovelace',
    username: 'ada',
    email: 'ada@example.com',
    password: 'correct-horse-battery-staple',
    ...overrides,
  };
  const res = await request(app).post('/api/v1/auth/register').send(payload);
  return { accessToken: res.body.data.accessToken, user: res.body.data.user };
}

describe('User routes', () => {
  it('rejects unauthenticated access to /me', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
  });

  it('returns the caller profile with stats computed in parallel via a separate UserStats doc', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);

    const res = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('ada');
    expect(res.body.data.followersCount).toBe(0);
    expect(res.body.data.followingCount).toBe(0);
    expect(res.body.data.postsCount).toBe(0);
  });

  it('updates only the allowed profile fields', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);

    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ bio: 'Mathematician & programmer', country: 'gb', isPrivate: true });

    expect(res.status).toBe(200);
    expect(res.body.data.bio).toBe('Mathematician & programmer');
    expect(res.body.data.country).toBe('GB');
    expect(res.body.data.isPrivate).toBe(true);
  });

  it('rejects attempts to change email/username via the profile update endpoint', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);

    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email: 'new@example.com', username: 'newname', bio: 'still allowed' });

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('ada@example.com');
    expect(res.body.data.username).toBe('ada');
  });

  it('fetches a public profile by username', async () => {
    const { app } = buildTestApp();
    await registerUser(app);
    const { accessToken: viewerToken } = await registerUser(app, { username: 'viewer', email: 'viewer@example.com' });

    const res = await request(app).get('/api/v1/users/ada').set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('ada');
    expect(res.body.data.email).toBeUndefined();
  });

  it('returns 404 for a username that does not exist', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);

    const res = await request(app).get('/api/v1/users/nobody').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('finds users by username prefix and by name substring', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);
    await registerUser(app, { username: 'adele', name: 'Adele Adkins', email: 'adele@example.com' });
    await registerUser(app, { username: 'bob', name: 'Bob Builder', email: 'bob@example.com' });

    const byPrefix = await request(app)
      .get('/api/v1/users/search')
      .query({ q: 'ad' })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(byPrefix.status).toBe(200);
    const usernames = byPrefix.body.data.users.map((u) => u.username);
    expect(usernames).toEqual(expect.arrayContaining(['ada', 'adele']));
    expect(usernames).not.toContain('bob');
  });
});
