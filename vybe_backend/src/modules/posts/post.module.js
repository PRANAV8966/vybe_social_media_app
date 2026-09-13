const { PostRepository } = require('./repositories/post.repository');
const { LikeRepository } = require('./repositories/like.repository');
const { PostService } = require('./services/post.service');
const { LikeService } = require('./services/like.service');
const { PostController } = require('./controllers/post.controller');
const { LikeController } = require('./controllers/like.controller');
const { PostMediaStorage } = require('./storage/postMediaStorage');
const { s3Client } = require('../../config/s3');
const env = require('../../config/env');

function registerPostsModule(container) {
  container.registerSingleton('postRepository', () => new PostRepository());
  container.registerSingleton('likeRepository', () => new LikeRepository());
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
        c.resolve('likeRepository'),
      ),
  );
  container.registerSingleton(
    'likeService',
    (c) =>
      new LikeService(
        c.resolve('likeRepository'),
        c.resolve('postRepository'),
        container.has('followRepository') ? c.resolve('followRepository') : null,
      ),
  );
  container.registerSingleton('postController', (c) => new PostController(c.resolve('postService')));
  container.registerSingleton('likeController', (c) => new LikeController(c.resolve('likeService')));
}

module.exports = { registerPostsModule };
