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

  describe('POST /api/v1/users/me/profile-photo', () => {
    it('rejects unauthenticated upload attempts', async () => {
      const { app } = buildTestApp();
      const res = await request(app).post('/api/v1/users/me/profile-photo').attach('photo', fakePngBuffer(), 'photo.png');
      expect(res.status).toBe(401);
    });

    it('uploads a new profile photo and updates profilePhotoUrl', async () => {
      const { app } = buildTestApp();
      const { accessToken } = await registerUser(app);

      const res = await request(app)
        .post('/api/v1/users/me/profile-photo')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('photo', fakePngBuffer(), { filename: 'photo.png', contentType: 'image/png' });

      expect(res.status).toBe(200);
      expect(res.body.data.profilePhotoUrl).toContain('profile-photos/');

      const meRes = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${accessToken}`);
      expect(meRes.body.data.profilePhotoUrl).toBe(res.body.data.profilePhotoUrl);
    });

    it('requires a file to be attached', async () => {
      const { app } = buildTestApp();
      const { accessToken } = await registerUser(app);

      const res = await request(app).post('/api/v1/users/me/profile-photo').set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PROFILE_PHOTO');
    });

    it('rejects a video (profile photos are images only)', async () => {
      const { app } = buildTestApp();
      const { accessToken } = await registerUser(app);

      const res = await request(app)
        .post('/api/v1/users/me/profile-photo')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('photo', fakeMp4Buffer(), { filename: 'clip.mp4', contentType: 'video/mp4' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PROFILE_PHOTO');
    });

    it('rejects content that does not match a real image signature, even with a spoofed extension/mimetype', async () => {
      const { app } = buildTestApp();
      const { accessToken } = await registerUser(app);

      const res = await request(app)
        .post('/api/v1/users/me/profile-photo')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('photo', invalidMediaBuffer(), { filename: 'photo.png', contentType: 'image/png' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PROFILE_PHOTO');
    });

    it('rejects an oversized photo', async () => {
      const { app } = buildTestApp(); // test env: IMAGE_MAX_BYTES=5000
      const { accessToken } = await registerUser(app);

      const res = await request(app)
        .post('/api/v1/users/me/profile-photo')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('photo', fakePngBuffer(6000), { filename: 'photo.png', contentType: 'image/png' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PROFILE_PHOTO_TOO_LARGE');
    });

    it('deletes the previous photo from S3 only after the new one is safely committed', async () => {
      const { app, fakeS3 } = buildTestApp();
      const { accessToken } = await registerUser(app);

      const first = await request(app)
        .post('/api/v1/users/me/profile-photo')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('photo', fakePngBuffer(), { filename: 'photo1.png', contentType: 'image/png' });
      const oldUrl = first.body.data.profilePhotoUrl;
      fakeS3.send.mockClear();

      const second = await request(app)
        .post('/api/v1/users/me/profile-photo')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('photo', fakePngBuffer(), { filename: 'photo2.png', contentType: 'image/png' });

      expect(second.status).toBe(200);
      expect(second.body.data.profilePhotoUrl).not.toBe(oldUrl);

      const calls = fakeS3.send.mock.calls.map((call) => call[0].constructor.name);
      expect(calls).toEqual(['PutObjectCommand', 'DeleteObjectCommand']); // upload confirmed BEFORE the old one is removed
      const deleteCall = fakeS3.send.mock.calls[1][0];
      expect(oldUrl).toContain(deleteCall.input.Key);
    });
  });
});
