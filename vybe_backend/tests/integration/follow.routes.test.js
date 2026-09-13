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

async function getPublicProfile(app, token, username) {
  return request(app).get(`/api/v1/users/${username}`).set('Authorization', `Bearer ${token}`);
}

describe('Follow routes', () => {
  it('rejects unauthenticated requests', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/api/v1/follow/someone');
    expect(res.status).toBe(401);
  });

  it('returns 404 when following a username that does not exist', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);
    const res = await request(app).post('/api/v1/follow/ghost').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('rejects following yourself', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);
    const res = await request(app).post('/api/v1/follow/ada').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_FOLLOW_SELF');
  });

  it('follows a user, updates both counters, and is idempotent on a repeat follow', async () => {
    const { app } = buildTestApp();
    const { accessToken: aliceToken } = await registerUser(app);
    await registerUser(app, { username: 'bob', email: 'bob@example.com' });

    const first = await request(app).post('/api/v1/follow/bob').set('Authorization', `Bearer ${aliceToken}`);
    expect(first.status).toBe(200);
    expect(first.body.data.following).toBe(true);

    const aliceProfile = await getPublicProfile(app, aliceToken, 'ada');
    const bobProfile = await getPublicProfile(app, aliceToken, 'bob');
    expect(aliceProfile.body.data.followingCount).toBe(1);
    expect(bobProfile.body.data.followersCount).toBe(1);

    // Idempotent replay — no error, no double count.
    const second = await request(app).post('/api/v1/follow/bob').set('Authorization', `Bearer ${aliceToken}`);
    expect(second.status).toBe(200);
    expect(second.body.data.following).toBe(true);

    const bobProfileAfterReplay = await getPublicProfile(app, aliceToken, 'bob');
    expect(bobProfileAfterReplay.body.data.followersCount).toBe(1);
  });

  it('is directional — Bob following Alice does not mean Alice follows Bob', async () => {
    const { app } = buildTestApp();
    const { accessToken: aliceToken } = await registerUser(app);
    const { accessToken: bobToken } = await registerUser(app, { username: 'bob', email: 'bob@example.com' });

    await request(app).post('/api/v1/follow/ada').set('Authorization', `Bearer ${bobToken}`);

    const aliceFollowsBob = await request(app).get('/api/v1/follow/bob/status').set('Authorization', `Bearer ${aliceToken}`);
    const bobFollowsAlice = await request(app).get('/api/v1/follow/ada/status').set('Authorization', `Bearer ${bobToken}`);

    expect(aliceFollowsBob.body.data.following).toBe(false);
    expect(bobFollowsAlice.body.data.following).toBe(true);
  });

  it('unfollows a user, decrements both counters, and is idempotent when not following', async () => {
    const { app } = buildTestApp();
    const { accessToken: aliceToken } = await registerUser(app);
    await registerUser(app, { username: 'bob', email: 'bob@example.com' });

    await request(app).post('/api/v1/follow/bob').set('Authorization', `Bearer ${aliceToken}`);
    const unfollowRes = await request(app).delete('/api/v1/follow/bob').set('Authorization', `Bearer ${aliceToken}`);
    expect(unfollowRes.status).toBe(200);
    expect(unfollowRes.body.data.following).toBe(false);

    const bobProfile = await getPublicProfile(app, aliceToken, 'bob');
    expect(bobProfile.body.data.followersCount).toBe(0);

    // Idempotent — unfollowing again is still a clean 200, not an error.
    const secondUnfollow = await request(app).delete('/api/v1/follow/bob').set('Authorization', `Bearer ${aliceToken}`);
    expect(secondUnfollow.status).toBe(200);
    expect(secondUnfollow.body.data.following).toBe(false);
  });

  it('paginates followers and following lists with a cursor', async () => {
    const { app } = buildTestApp();
    const { accessToken: targetToken } = await registerUser(app, { username: 'popular', email: 'popular@example.com' });

    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { accessToken } = await registerUser(app, { username: `follower${i}`, email: `follower${i}@example.com` });
      // eslint-disable-next-line no-await-in-loop
      await request(app).post('/api/v1/follow/popular').set('Authorization', `Bearer ${accessToken}`);
    }

    const firstPage = await request(app)
      .get('/api/v1/follow/popular/followers')
      .query({ limit: 2 })
      .set('Authorization', `Bearer ${targetToken}`);
    expect(firstPage.body.data.users).toHaveLength(2);
    expect(firstPage.body.data.nextCursor).toEqual(expect.any(String));

    const secondPage = await request(app)
      .get('/api/v1/follow/popular/followers')
      .query({ limit: 2, cursor: firstPage.body.data.nextCursor })
      .set('Authorization', `Bearer ${targetToken}`);
    expect(secondPage.body.data.users).toHaveLength(1);

    const { accessToken: followerToken } = await registerUser(app, { username: 'checker', email: 'checker@example.com' });
    await request(app).post('/api/v1/follow/follower0').set('Authorization', `Bearer ${followerToken}`);
    await request(app).post('/api/v1/follow/follower1').set('Authorization', `Bearer ${followerToken}`);

    const followingRes = await request(app).get('/api/v1/follow/checker/following').set('Authorization', `Bearer ${followerToken}`);
    expect(followingRes.body.data.users.map((u) => u.username).sort()).toEqual(['follower0', 'follower1']);
  });
});
