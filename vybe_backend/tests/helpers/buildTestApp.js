const Container = require('../../src/container/Container');
const { registerUsersModule } = require('../../src/modules/users/user.module');
const { registerAuthModule } = require('../../src/modules/auth/auth.module');
const { registerPostsModule } = require('../../src/modules/posts/post.module');
const { registerFollowModule } = require('../../src/modules/follow/follow.module');
const { registerChatModule } = require('../../src/modules/chat/chat.module');
const { createApp } = require('../../src/app');
const { ProfilePhotoStorage } = require('../../src/modules/users/storage/profilePhotoStorage');
const { PostMediaStorage } = require('../../src/modules/posts/storage/postMediaStorage');
const env = require('../../src/config/env');

function createFakeS3Client() {
  return { send: jest.fn().mockResolvedValue({}) };
}

/**
 * Wires a real container against the (in-memory) database for the current
 * test file. `googleVerifier`, when given, replaces the real Google
 * verification client so tests never call out to Google. S3 is ALWAYS faked
 * (real storage-class logic — key building, magic-byte validation — runs for
 * real; only the actual network call is swapped out) so tests never touch
 * real AWS. The fake client is returned so tests can assert on
 * `fakeS3.send.mock.calls` (e.g. to check a PutObjectCommand's key/body).
 */
function buildTestApp({ googleVerifier, fakeS3 = createFakeS3Client() } = {}) {
  const container = new Container();
  registerUsersModule(container);
  registerAuthModule(container);
  registerFollowModule(container);
  registerPostsModule(container);
  registerChatModule(container);

  if (googleVerifier) {
    container.registerInstance('googleTokenVerifier', googleVerifier);
  }

  container.registerInstance(
    'profilePhotoStorage',
    new ProfilePhotoStorage(fakeS3, {
      bucket: env.s3.bucket,
      region: env.s3.region,
      cdnBaseUrl: env.s3.cdnBaseUrl,
      maxBytes: env.uploads.imageMaxBytes,
    }),
  );
  container.registerInstance(
    'postMediaStorage',
    new PostMediaStorage(fakeS3, {
      bucket: env.s3.bucket,
      region: env.s3.region,
      cdnBaseUrl: env.s3.cdnBaseUrl,
      imageMaxBytes: env.uploads.imageMaxBytes,
      videoMaxBytes: env.uploads.videoMaxBytes,
    }),
  );

  const app = createApp(container);
  return { app, container, fakeS3 };
}

module.exports = { buildTestApp };
