const { PostMediaStorage } = require('../../src/modules/posts/storage/postMediaStorage');
const { UnsupportedPostMediaError, PostMediaTooLargeError } = require('../../src/modules/posts/errors/post.errors');
const { fakePngBuffer, fakeMp4Buffer, invalidMediaBuffer } = require('../helpers/mediaFixtures');

function buildStorage(overrides = {}) {
  const s3Client = { send: jest.fn().mockResolvedValue({}) };
  const storage = new PostMediaStorage(s3Client, {
    bucket: 'test-bucket',
    region: 'us-east-1',
    cdnBaseUrl: null,
    imageMaxBytes: 5000,
    videoMaxBytes: 10000,
    ...overrides,
  });
  return { storage, s3Client };
}

describe('PostMediaStorage', () => {
  describe('validate', () => {
    it('accepts a valid image within the image size limit', () => {
      const { storage } = buildStorage();
      expect(storage.validate(fakePngBuffer(), 'image/png')).toEqual({ mediaType: 'image', ext: 'png', contentType: 'image/png' });
    });

    it('accepts a valid video within the (higher) video size limit', () => {
      const { storage } = buildStorage();
      const buf = fakeMp4Buffer(9000); // over the image limit, within the video limit
      expect(storage.validate(buf, 'video/mp4')).toEqual({ mediaType: 'video', ext: 'mp4', contentType: 'video/mp4' });
    });

    it('rejects content that matches no known image/video signature', () => {
      const { storage } = buildStorage();
      expect(() => storage.validate(invalidMediaBuffer(), 'image/png')).toThrow(UnsupportedPostMediaError);
    });

    it('rejects an image that exceeds the IMAGE limit even though it is well within the VIDEO limit', () => {
      const { storage } = buildStorage();
      const oversizedImage = fakePngBuffer(9000); // > imageMaxBytes(5000), < videoMaxBytes(10000)
      expect(() => storage.validate(oversizedImage, 'image/png')).toThrow(PostMediaTooLargeError);
    });

    it('rejects a video that exceeds the video limit', () => {
      const { storage } = buildStorage();
      const oversizedVideo = fakeMp4Buffer(11000);
      expect(() => storage.validate(oversizedVideo, 'video/mp4')).toThrow(PostMediaTooLargeError);
    });
  });

  describe('upload', () => {
    it('uses a deterministic key when clientRequestId is given (idempotent overwrite on retry)', async () => {
      const { storage, s3Client } = buildStorage();
      const url1 = await storage.upload({
        authorId: 'author1',
        buffer: fakePngBuffer(),
        ext: 'png',
        contentType: 'image/png',
        clientRequestId: 'retry-key-1',
      });
      const url2 = await storage.upload({
        authorId: 'author1',
        buffer: fakePngBuffer(),
        ext: 'png',
        contentType: 'image/png',
        clientRequestId: 'retry-key-1',
      });

      expect(url1).toBe(url2);
      expect(url1).toContain('posts/author1/retry-key-1.png');
      expect(s3Client.send).toHaveBeenCalledTimes(2); // both calls hit the SAME key — an overwrite, not an orphan
    });

    it('rejects an unsafe clientRequestId and falls back to a random key instead of using it verbatim', async () => {
      const { storage } = buildStorage();
      const url = await storage.upload({
        authorId: 'author1',
        buffer: fakePngBuffer(),
        ext: 'png',
        contentType: 'image/png',
        clientRequestId: '../../etc/passwd',
      });
      expect(url).not.toContain('../../etc/passwd');
    });

    it('uses a random key when no clientRequestId is given — two uploads never collide', async () => {
      const { storage } = buildStorage();
      const url1 = await storage.upload({ authorId: 'author1', buffer: fakePngBuffer(), ext: 'png', contentType: 'image/png' });
      const url2 = await storage.upload({ authorId: 'author1', buffer: fakePngBuffer(), ext: 'png', contentType: 'image/png' });
      expect(url1).not.toBe(url2);
    });

    it('builds a CDN-based URL when cdnBaseUrl is configured', async () => {
      const { storage } = buildStorage({ cdnBaseUrl: 'https://cdn.example.com' });
      const url = await storage.upload({ authorId: 'author1', buffer: fakePngBuffer(), ext: 'png', contentType: 'image/png' });
      expect(url.startsWith('https://cdn.example.com/posts/author1/')).toBe(true);
    });
  });

  describe('deleteByUrl', () => {
    it('deletes using the key extracted from a previously-built URL', async () => {
      const { storage, s3Client } = buildStorage();
      const url = await storage.upload({ authorId: 'author1', buffer: fakePngBuffer(), ext: 'png', contentType: 'image/png' });
      s3Client.send.mockClear();

      await storage.deleteByUrl(url);

      expect(s3Client.send).toHaveBeenCalledTimes(1);
      const command = s3Client.send.mock.calls[0][0];
      expect(command.input.Bucket).toBe('test-bucket');
      expect(url).toContain(command.input.Key);
    });

    it('is a safe no-op for a null/foreign URL it cannot extract a key from', async () => {
      const { storage, s3Client } = buildStorage();
      await expect(storage.deleteByUrl(null)).resolves.toBeUndefined();
      await expect(storage.deleteByUrl('https://not-our-bucket.example.com/foo.png')).resolves.toBeUndefined();
      expect(s3Client.send).not.toHaveBeenCalled();
    });

    it('never throws when S3 itself fails — best-effort cleanup only', async () => {
      const { storage, s3Client } = buildStorage();
      const url = await storage.upload({ authorId: 'author1', buffer: fakePngBuffer(), ext: 'png', contentType: 'image/png' });
      s3Client.send.mockRejectedValueOnce(new Error('S3 is down'));

      await expect(storage.deleteByUrl(url)).resolves.toBeUndefined();
    });
  });
});
