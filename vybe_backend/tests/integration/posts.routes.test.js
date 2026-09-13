const request = require('supertest');
const { buildTestApp } = require('../helpers/buildTestApp');
const { fakePngBuffer, fakeMp4Buffer, invalidMediaBuffer } = require('../helpers/mediaFixtures');

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

/** Post creation/edit is always multipart/form-data now (media arrives as req.file) — this builds that request. */
function createPostRequest(app, token, { text, clientRequestId } = {}) {
  const req = request(app).post('/api/v1/posts').set('Authorization', `Bearer ${token}`);
  if (text !== undefined) req.field('text', text);
  if (clientRequestId !== undefined) req.field('clientRequestId', clientRequestId);
  return req;
}

function editPostRequest(app, token, postId, { text } = {}) {
  const req = request(app).patch(`/api/v1/posts/${postId}`).set('Authorization', `Bearer ${token}`);
  if (text !== undefined) req.field('text', text);
  return req;
}

describe('Post routes', () => {
  it('rejects unauthenticated post creation', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/api/v1/posts').field('text', 'hello');
    expect(res.status).toBe(401);
  });

  it('creates a text-only post and increments the author postsCount', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);

    const createRes = await createPostRequest(app, accessToken, { text: 'hello world' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.text).toBe('hello world');
    expect(createRes.body.data.isEdited).toBe(false);
    expect(createRes.body.data.mediaUrl).toBeNull();
    expect(createRes.body.data.mediaType).toBeNull();

    const meRes = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${accessToken}`);
    expect(meRes.body.data.postsCount).toBe(1);
  });

  it('is idempotent when the same clientRequestId is submitted twice', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);

    const first = await createPostRequest(app, accessToken, { text: 'idempotent post', clientRequestId: 'retry-key-1' });
    const second = await createPostRequest(app, accessToken, { text: 'idempotent post', clientRequestId: 'retry-key-1' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);

    const meRes = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${accessToken}`);
    expect(meRes.body.data.postsCount).toBe(1); // the replay must not double-count
  });

  it('allows two different posts without a clientRequestId from the same author (no false collision)', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);

    const first = await createPostRequest(app, accessToken, { text: 'post one' });
    const second = await createPostRequest(app, accessToken, { text: 'post two' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.id).not.toBe(second.body.data.id);
  });

  it('lets the author edit their own post', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);
    const createRes = await createPostRequest(app, accessToken, { text: 'original' });

    const editRes = await editPostRequest(app, accessToken, createRes.body.data.id, { text: 'edited' });

    expect(editRes.status).toBe(200);
    expect(editRes.body.data.text).toBe('edited');
    expect(editRes.body.data.isEdited).toBe(true);
  });

  it('returns 404 (not 403) when a different user tries to edit or delete a post they do not own', async () => {
    const { app } = buildTestApp();
    const { accessToken: ownerToken } = await registerUser(app);
    const { accessToken: strangerToken } = await registerUser(app, { username: 'stranger', email: 'stranger@example.com' });
    const createRes = await createPostRequest(app, ownerToken, { text: 'mine' });
    const postId = createRes.body.data.id;

    const editAttempt = await editPostRequest(app, strangerToken, postId, { text: 'hijacked' });
    const deleteAttempt = await request(app).delete(`/api/v1/posts/${postId}`).set('Authorization', `Bearer ${strangerToken}`);

    expect(editAttempt.status).toBe(404);
    expect(editAttempt.body.error.code).toBe('POST_NOT_FOUND');
    expect(deleteAttempt.status).toBe(404);

    const stillThere = await request(app).get(`/api/v1/posts/id/${postId}`).set('Authorization', `Bearer ${ownerToken}`);
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.data.text).toBe('mine');
  });

  it('rejects an edit with neither text nor media', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);
    const createRes = await createPostRequest(app, accessToken, { text: 'original' });

    const res = await request(app)
      .patch(`/api/v1/posts/${createRes.body.data.id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('POST_VALIDATION_ERROR');
  });

  it('soft-deletes a post and decrements postsCount, and it no longer appears in listings', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);
    const createRes = await createPostRequest(app, accessToken, { text: 'temporary' });
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
      await createPostRequest(app, accessToken, { text: `post ${i}` });
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

      await createPostRequest(app, ownerToken, { text: 'secret post' });
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
      await createPostRequest(app, ownerToken, { text: 'secret post' });
      await request(app).patch('/api/v1/users/me').set('Authorization', `Bearer ${ownerToken}`).send({ isPrivate: true });

      const res = await request(app).get('/api/v1/posts/user/ada').set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.posts).toHaveLength(1);
    });
  });

  describe('media attachments', () => {
    it('creates a post with an attached image', async () => {
      const { app } = buildTestApp();
      const { accessToken } = await registerUser(app);

      const res = await createPostRequest(app, accessToken, { text: 'look at this' }).attach('media', fakePngBuffer(), {
        filename: 'photo.png',
        contentType: 'image/png',
      });

      expect(res.status).toBe(201);
      expect(res.body.data.mediaType).toBe('image');
      expect(res.body.data.mediaUrl).toEqual(expect.any(String));
    });

    it('creates a post with an attached video', async () => {
      const { app } = buildTestApp();
      const { accessToken } = await registerUser(app);

      const res = await createPostRequest(app, accessToken, { text: 'watch this' }).attach('media', fakeMp4Buffer(), {
        filename: 'clip.mp4',
        contentType: 'video/mp4',
      });

      expect(res.status).toBe(201);
      expect(res.body.data.mediaType).toBe('video');
    });

    it('rejects a file whose content does not match any supported image/video signature', async () => {
      const { app } = buildTestApp();
      const { accessToken } = await registerUser(app);

      const res = await createPostRequest(app, accessToken, { text: 'fake image' }).attach('media', invalidMediaBuffer(), {
        filename: 'photo.png',
        contentType: 'image/png', // spoofed — content sniffing must catch this regardless
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('UNSUPPORTED_POST_MEDIA');
    });

    it('rejects an image over the image size limit even though it is under the multer-level (video) ceiling', async () => {
      const { app } = buildTestApp(); // test env: IMAGE_MAX_BYTES=5000, VIDEO_MAX_BYTES=10000
      const { accessToken } = await registerUser(app);

      const res = await createPostRequest(app, accessToken, { text: 'big image' }).attach('media', fakePngBuffer(6000), {
        filename: 'photo.png',
        contentType: 'image/png',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('POST_MEDIA_TOO_LARGE');
    });

    it('rejects a file over the hard multer-level size ceiling', async () => {
      const { app } = buildTestApp();
      const { accessToken } = await registerUser(app);

      const res = await createPostRequest(app, accessToken, { text: 'huge file' }).attach('media', fakeMp4Buffer(11000), {
        filename: 'clip.mp4',
        contentType: 'video/mp4',
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('POST_MEDIA_TOO_LARGE');
    });

    it('does not re-upload media on a clientRequestId replay', async () => {
      const { app, fakeS3 } = buildTestApp();
      const { accessToken } = await registerUser(app);

      const first = await createPostRequest(app, accessToken, { text: 'once', clientRequestId: 'media-retry-1' }).attach(
        'media',
        fakePngBuffer(),
        { filename: 'photo.png', contentType: 'image/png' },
      );
      expect(first.status).toBe(201);
      const uploadsAfterFirst = fakeS3.send.mock.calls.length;

      const second = await createPostRequest(app, accessToken, { text: 'once', clientRequestId: 'media-retry-1' }).attach(
        'media',
        fakePngBuffer(),
        { filename: 'photo.png', contentType: 'image/png' },
      );

      expect(second.status).toBe(200);
      expect(second.body.data.mediaUrl).toBe(first.body.data.mediaUrl);
      expect(fakeS3.send.mock.calls.length).toBe(uploadsAfterFirst); // no new S3 call for the replay
    });

    it('replaces post media on edit and deletes the old object only after the DB commit', async () => {
      const { app, fakeS3 } = buildTestApp();
      const { accessToken } = await registerUser(app);

      const createRes = await createPostRequest(app, accessToken, { text: 'v1' }).attach('media', fakePngBuffer(), {
        filename: 'photo.png',
        contentType: 'image/png',
      });
      const oldUrl = createRes.body.data.mediaUrl;
      fakeS3.send.mockClear();

      const editRes = await editPostRequest(app, accessToken, createRes.body.data.id, {}).attach(
        'media',
        fakeMp4Buffer(),
        { filename: 'clip.mp4', contentType: 'video/mp4' },
      );

      expect(editRes.status).toBe(200);
      expect(editRes.body.data.mediaType).toBe('video');
      expect(editRes.body.data.mediaUrl).not.toBe(oldUrl);

      const deleteCalls = fakeS3.send.mock.calls.filter((call) => call[0].constructor.name === 'DeleteObjectCommand');
      expect(deleteCalls).toHaveLength(1);
      expect(oldUrl).toContain(deleteCalls[0][0].input.Key);
    });

    it('keeps existing media untouched when an edit only changes text', async () => {
      const { app, fakeS3 } = buildTestApp();
      const { accessToken } = await registerUser(app);

      const createRes = await createPostRequest(app, accessToken, { text: 'v1' }).attach('media', fakePngBuffer(), {
        filename: 'photo.png',
        contentType: 'image/png',
      });
      fakeS3.send.mockClear();

      const editRes = await editPostRequest(app, accessToken, createRes.body.data.id, { text: 'v2' });

      expect(editRes.status).toBe(200);
      expect(editRes.body.data.mediaUrl).toBe(createRes.body.data.mediaUrl);
      expect(fakeS3.send).not.toHaveBeenCalled();
    });
  });
});
