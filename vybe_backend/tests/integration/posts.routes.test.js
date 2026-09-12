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

describe('Post routes', () => {
  it('rejects unauthenticated post creation', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/api/v1/posts').send({ text: 'hello' });
    expect(res.status).toBe(401);
  });

  it('creates a post and increments the author postsCount', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);

    const createRes = await request(app)
      .post('/api/v1/posts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'hello world' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.text).toBe('hello world');
    expect(createRes.body.data.isEdited).toBe(false);

    const meRes = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${accessToken}`);
    expect(meRes.body.data.postsCount).toBe(1);
  });

  it('is idempotent when the same clientRequestId is submitted twice', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);

    const first = await request(app)
      .post('/api/v1/posts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'idempotent post', clientRequestId: 'retry-key-1' });
    const second = await request(app)
      .post('/api/v1/posts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'idempotent post', clientRequestId: 'retry-key-1' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);

    const meRes = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${accessToken}`);
    expect(meRes.body.data.postsCount).toBe(1); // the replay must not double-count
  });

  it('allows two different posts without a clientRequestId from the same author (no false collision)', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);

    const first = await request(app).post('/api/v1/posts').set('Authorization', `Bearer ${accessToken}`).send({ text: 'post one' });
    const second = await request(app).post('/api/v1/posts').set('Authorization', `Bearer ${accessToken}`).send({ text: 'post two' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.id).not.toBe(second.body.data.id);
  });

  it('lets the author edit their own post', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);
    const createRes = await request(app).post('/api/v1/posts').set('Authorization', `Bearer ${accessToken}`).send({ text: 'original' });

    const editRes = await request(app)
      .patch(`/api/v1/posts/${createRes.body.data.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'edited' });

    expect(editRes.status).toBe(200);
    expect(editRes.body.data.text).toBe('edited');
    expect(editRes.body.data.isEdited).toBe(true);
  });

  it('returns 404 (not 403) when a different user tries to edit or delete a post they do not own', async () => {
    const { app } = buildTestApp();
    const { accessToken: ownerToken } = await registerUser(app);
    const { accessToken: strangerToken } = await registerUser(app, { username: 'stranger', email: 'stranger@example.com' });
    const createRes = await request(app).post('/api/v1/posts').set('Authorization', `Bearer ${ownerToken}`).send({ text: 'mine' });
    const postId = createRes.body.data.id;

    const editAttempt = await request(app)
      .patch(`/api/v1/posts/${postId}`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ text: 'hijacked' });
    const deleteAttempt = await request(app).delete(`/api/v1/posts/${postId}`).set('Authorization', `Bearer ${strangerToken}`);

    expect(editAttempt.status).toBe(404);
    expect(editAttempt.body.error.code).toBe('POST_NOT_FOUND');
    expect(deleteAttempt.status).toBe(404);

    const stillThere = await request(app).get(`/api/v1/posts/id/${postId}`).set('Authorization', `Bearer ${ownerToken}`);
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.data.text).toBe('mine');
  });

  it('soft-deletes a post and decrements postsCount, and it no longer appears in listings', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);
    const createRes = await request(app).post('/api/v1/posts').set('Authorization', `Bearer ${accessToken}`).send({ text: 'temporary' });
    const postId = createRes.body.data.id;

    const deleteRes = await request(app).delete(`/api/v1/posts/${postId}`).set('Authorization', `Bearer ${accessToken}`);
    expect(deleteRes.status).toBe(200);

    const getRes = await request(app).get(`/api/v1/posts/id/${postId}`).set('Authorization', `Bearer ${accessToken}`);
    expect(getRes.status).toBe(404);

    const meRes = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${accessToken}`);
    expect(meRes.body.data.postsCount).toBe(0);
  });

  it('paginates a user post listing with a cursor', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await request(app).post('/api/v1/posts').set('Authorization', `Bearer ${accessToken}`).send({ text: `post ${i}` });
    }

    const firstPage = await request(app)
      .get('/api/v1/posts/user/ada')
      .query({ limit: 2 })
      .set('Authorization', `Bearer ${accessToken}`);
    expect(firstPage.body.data.posts).toHaveLength(2);
    expect(firstPage.body.data.nextCursor).toEqual(expect.any(String));

    const secondPage = await request(app)
      .get('/api/v1/posts/user/ada')
      .query({ limit: 2, cursor: firstPage.body.data.nextCursor })
      .set('Authorization', `Bearer ${accessToken}`);
    expect(secondPage.body.data.posts).toHaveLength(2);

    const firstIds = firstPage.body.data.posts.map((p) => p.id);
    const secondIds = secondPage.body.data.posts.map((p) => p.id);
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
  });

  describe('private accounts', () => {
    it('hides posts from a non-owner when the account is private', async () => {
      const { app } = buildTestApp();
      const { accessToken: ownerToken } = await registerUser(app);
      const { accessToken: strangerToken } = await registerUser(app, { username: 'stranger', email: 'stranger@example.com' });

      await request(app).post('/api/v1/posts').set('Authorization', `Bearer ${ownerToken}`).send({ text: 'secret post' });
      await request(app).patch('/api/v1/users/me').set('Authorization', `Bearer ${ownerToken}`).send({ isPrivate: true });

      const res = await request(app).get('/api/v1/posts/user/ada').set('Authorization', `Bearer ${strangerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.isPrivate).toBe(true);
      expect(res.body.data.isFollowing).toBe(false);
      expect(res.body.data.posts).toHaveLength(0);
    });

    it('still lets the owner see their own posts once private', async () => {
      const { app } = buildTestApp();
      const { accessToken: ownerToken } = await registerUser(app);
      await request(app).post('/api/v1/posts').set('Authorization', `Bearer ${ownerToken}`).send({ text: 'secret post' });
      await request(app).patch('/api/v1/users/me').set('Authorization', `Bearer ${ownerToken}`).send({ isPrivate: true });

      const res = await request(app).get('/api/v1/posts/user/ada').set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.posts).toHaveLength(1);
    });
  });
});
