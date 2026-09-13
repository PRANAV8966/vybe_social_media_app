const { PostRepository } = require('./repositories/post.repository');
const { PostService } = require('./services/post.service');
const { PostController } = require('./controllers/post.controller');
const { PostMediaStorage } = require('./storage/postMediaStorage');
const { s3Client } = require('../../config/s3');
const env = require('../../config/env');

function registerPostsModule(container) {
  container.registerSingleton('postRepository', () => new PostRepository());
  container.registerSingleton(
    'postMediaStorage',
    () =>
      new PostMediaStorage(s3Client, {
        bucket: env.s3.bucket,
        region: env.s3.region,
        cdnBaseUrl: env.s3.cdnBaseUrl,
        imageMaxBytes: env.uploads.imageMaxBytes,
        videoMaxBytes: env.uploads.videoMaxBytes,
      }),
  );
  container.registerSingleton(
    'postService',
    (c) =>
      new PostService(
        c.resolve('postRepository'),
        c.resolve('userRepository'),
        c.resolve('userStatsRepository'),
        c.resolve('postMediaStorage'),
        container.has('followRepository') ? c.resolve('followRepository') : null,
      ),
  );
  container.registerSingleton('postController', (c) => new PostController(c.resolve('postService')));
}

module.exports = { registerPostsModule };
