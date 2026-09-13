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

  describe('likes', () => {
    function setLikeState(app, token, postId, liked) {
      return request(app).put(`/api/v1/posts/${postId}/like`).set('Authorization', `Bearer ${token}`).send({ liked });
    }

    async function follow(app, token, targetUsername) {
      return request(app).post(`/api/v1/follow/${targetUsername}`).set('Authorization', `Bearer ${token}`);
    }

    it('rejects an unauthenticated like attempt', async () => {
      const { app } = buildTestApp();
      const res = await request(app).put('/api/v1/posts/507f1f77bcf86cd799439011/like').send({ liked: true });
      expect(res.status).toBe(401);
    });

    it('rejects a malformed postId and a missing "liked" field', async () => {
      const { app } = buildTestApp();
      const { accessToken } = await registerUser(app);

      const badId = await setLikeState(app, accessToken, 'not-an-object-id', true);
      expect(badId.status).toBe(400);
      expect(badId.body.error.code).toBe('VALIDATION_ERROR');

      const createRes = await createPostRequest(app, accessToken, { text: 'target' });
      const missingBody = await request(app)
        .put(`/api/v1/posts/${createRes.body.data.id}/like`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({});
      expect(missingBody.status).toBe(400);
      expect(missingBody.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 for a non-existent post', async () => {
      const { app } = buildTestApp();
      const { accessToken } = await registerUser(app);
      const res = await setLikeState(app, accessToken, '507f1f77bcf86cd799439011', true);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('POST_NOT_FOUND');
    });

    it('likes a post, is idempotent on a repeat like, and unlikes it back to zero', async () => {
      const { app } = buildTestApp();
      const { accessToken } = await registerUser(app);
      const createRes = await createPostRequest(app, accessToken, { text: 'likeable' });
      const postId = createRes.body.data.id;
      expect(createRes.body.data.isLiked).toBe(false); // fresh post, nobody has liked it yet

      const first = await setLikeState(app, accessToken, postId, true);
      expect(first.status).toBe(200);
      expect(first.body.data).toEqual({ liked: true, likesCount: 1 });

      const replay = await setLikeState(app, accessToken, postId, true);
      expect(replay.status).toBe(200);
      expect(replay.body.data).toEqual({ liked: true, likesCount: 1 }); // no double count

      const getRes = await request(app).get(`/api/v1/posts/id/${postId}`).set('Authorization', `Bearer ${accessToken}`);
      expect(getRes.body.data.isLiked).toBe(true);
      expect(getRes.body.data.likesCount).toBe(1);

      const unlike = await setLikeState(app, accessToken, postId, false);
      expect(unlike.status).toBe(200);
      expect(unlike.body.data).toEqual({ liked: false, likesCount: 0 });

      const unlikeReplay = await setLikeState(app, accessToken, postId, false);
      expect(unlikeReplay.status).toBe(200);
      expect(unlikeReplay.body.data).toEqual({ liked: false, likesCount: 0 }); // idempotent, never goes negative
    });

    it('allows a self-like', async () => {
      const { app } = buildTestApp();
      const { accessToken } = await registerUser(app);
      const createRes = await createPostRequest(app, accessToken, { text: 'my own post' });

      const res = await setLikeState(app, accessToken, createRes.body.data.id, true);
      expect(res.status).toBe(200);
      expect(res.body.data.liked).toBe(true);
    });

    it('tracks isLiked independently per viewer', async () => {
      const { app } = buildTestApp();
      const { accessToken: ownerToken } = await registerUser(app);
      const { accessToken: strangerToken } = await registerUser(app, { username: 'stranger', email: 'stranger@example.com' });
      const createRes = await createPostRequest(app, ownerToken, { text: 'shared post' });
      const postId = createRes.body.data.id;

      await setLikeState(app, ownerToken, postId, true);

      const ownerView = await request(app).get(`/api/v1/posts/id/${postId}`).set('Authorization', `Bearer ${ownerToken}`);
      const strangerView = await request(app).get(`/api/v1/posts/id/${postId}`).set('Authorization', `Bearer ${strangerToken}`);

      expect(ownerView.body.data.isLiked).toBe(true);
      expect(strangerView.body.data.isLiked).toBe(false);
      expect(strangerView.body.data.likesCount).toBe(1); // the count itself is shared/global
    });

    it('reflects isLiked correctly across a paginated post list (batched lookup, no N+1)', async () => {
      const { app } = buildTestApp();
      const { accessToken } = await registerUser(app);
      const first = await createPostRequest(app, accessToken, { text: 'one' });
      const second = await createPostRequest(app, accessToken, { text: 'two' });
      await setLikeState(app, accessToken, second.body.data.id, true);

      const listRes = await request(app).get('/api/v1/posts/user/ada').set('Authorization', `Bearer ${accessToken}`);
      const byId = Object.fromEntries(listRes.body.data.posts.map((p) => [p.id, p]));

      expect(byId[first.body.data.id].isLiked).toBe(false);
      expect(byId[second.body.data.id].isLiked).toBe(true);
    });

    it('returns 404 (not a leak) when trying to like a post behind a private account you do not follow', async () => {
      const { app } = buildTestApp();
      const { accessToken: ownerToken } = await registerUser(app);
      const { accessToken: strangerToken } = await registerUser(app, { username: 'stranger', email: 'stranger@example.com' });
      const createRes = await createPostRequest(app, ownerToken, { text: 'private post' });
      await request(app).patch('/api/v1/users/me').set('Authorization', `Bearer ${ownerToken}`).send({ isPrivate: true });

      const res = await setLikeState(app, strangerToken, createRes.body.data.id, true);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('POST_NOT_FOUND');
    });

    it('allows liking a private account post once you follow them', async () => {
      const { app } = buildTestApp();
      const { accessToken: ownerToken } = await registerUser(app);
      const { accessToken: followerToken } = await registerUser(app, { username: 'follower', email: 'follower@example.com' });
      const createRes = await createPostRequest(app, ownerToken, { text: 'private post' });
      await request(app).patch('/api/v1/users/me').set('Authorization', `Bearer ${ownerToken}`).send({ isPrivate: true });
      await follow(app, followerToken, 'ada');

      const res = await setLikeState(app, followerToken, createRes.body.data.id, true);
      expect(res.status).toBe(200);
      expect(res.body.data.liked).toBe(true);
    });

    it('does not delete the post when unliking, and does not error unliking a post nobody liked', async () => {
      const { app } = buildTestApp();
      const { accessToken } = await registerUser(app);
      const createRes = await createPostRequest(app, accessToken, { text: 'never liked' });

      const res = await setLikeState(app, accessToken, createRes.body.data.id, false);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ liked: false, likesCount: 0 });

      const stillThere = await request(app).get(`/api/v1/posts/id/${createRes.body.data.id}`).set('Authorization', `Bearer ${accessToken}`);
      expect(stillThere.status).toBe(200);
    });
  });
});
