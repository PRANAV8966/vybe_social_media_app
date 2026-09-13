const { ProfilePhotoStorage } = require('../../src/modules/users/storage/profilePhotoStorage');
const { InvalidProfilePhotoError, ProfilePhotoTooLargeError } = require('../../src/modules/users/errors/user.errors');
const { fakePngBuffer, fakeMp4Buffer, invalidMediaBuffer } = require('../helpers/mediaFixtures');

function buildStorage(overrides = {}) {
  const s3Client = { send: jest.fn().mockResolvedValue({}) };
  const storage = new ProfilePhotoStorage(s3Client, {
    bucket: 'test-bucket',
    region: 'us-east-1',
    cdnBaseUrl: null,
    maxBytes: 5000,
    ...overrides,
  });
  return { storage, s3Client };
}

describe('ProfilePhotoStorage', () => {
  it('accepts a valid image within the size limit', () => {
    const { storage } = buildStorage();
    expect(storage.validate(fakePngBuffer())).toEqual({ mediaType: 'image', ext: 'png', contentType: 'image/png' });
  });

  it('rejects a video — profile photos are images only', () => {
    const { storage } = buildStorage();
    expect(() => storage.validate(fakeMp4Buffer())).toThrow(InvalidProfilePhotoError);
  });

  it('rejects content matching no known image signature', () => {
    const { storage } = buildStorage();
    expect(() => storage.validate(invalidMediaBuffer())).toThrow(InvalidProfilePhotoError);
  });

  it('rejects an oversized image', () => {
    const { storage } = buildStorage();
    expect(() => storage.validate(fakePngBuffer(6000))).toThrow(ProfilePhotoTooLargeError);
  });

  it('uploads to a user-scoped, randomly-keyed path — two uploads for the same user never collide', async () => {
    const { storage } = buildStorage();
    const url1 = await storage.upload('user1', fakePngBuffer(), { ext: 'png', contentType: 'image/png' });
    const url2 = await storage.upload('user1', fakePngBuffer(), { ext: 'png', contentType: 'image/png' });
    expect(url1).toContain('profile-photos/user1/');
    expect(url1).not.toBe(url2);
  });

  it('deletes the object referenced by a previously-built URL', async () => {
    const { storage, s3Client } = buildStorage();
    const url = await storage.upload('user1', fakePngBuffer(), { ext: 'png', contentType: 'image/png' });
    s3Client.send.mockClear();

    await storage.deleteByUrl(url);

    expect(s3Client.send).toHaveBeenCalledTimes(1);
    expect(url).toContain(s3Client.send.mock.calls[0][0].input.Key);
  });

  it('swallows a delete failure rather than throwing', async () => {
    const { storage, s3Client } = buildStorage();
    const url = await storage.upload('user1', fakePngBuffer(), { ext: 'png', contentType: 'image/png' });
    s3Client.send.mockRejectedValueOnce(new Error('S3 unavailable'));
    await expect(storage.deleteByUrl(url)).resolves.toBeUndefined();
  });
});
