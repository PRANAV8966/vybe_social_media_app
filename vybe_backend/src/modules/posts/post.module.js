const { PostRepository } = require('./repositories/post.repository');
const { PostService } = require('./services/post.service');
const { PostController } = require('./controllers/post.controller');

function registerPostsModule(container) {
  container.registerSingleton('postRepository', () => new PostRepository());
  container.registerSingleton(
    'postService',
    (c) =>
      new PostService(
        c.resolve('postRepository'),
        c.resolve('userRepository'),
        c.resolve('userStatsRepository'),
        container.has('followRepository') ? c.resolve('followRepository') : null,
      ),
  );
  container.registerSingleton('postController', (c) => new PostController(c.resolve('postService')));
}

module.exports = { registerPostsModule };
