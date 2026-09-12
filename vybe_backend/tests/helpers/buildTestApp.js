const Container = require('../../src/container/Container');
const { registerUsersModule } = require('../../src/modules/users/user.module');
const { registerAuthModule } = require('../../src/modules/auth/auth.module');
const { registerPostsModule } = require('../../src/modules/posts/post.module');
const { createApp } = require('../../src/app');

/**
 * Wires a real container against the (in-memory) database for the current
 * test file. `googleVerifier`, when given, replaces the real Google
 * verification client so tests never call out to Google.
 */
function buildTestApp({ googleVerifier } = {}) {
  const container = new Container();
  registerUsersModule(container);
  registerAuthModule(container);
  registerPostsModule(container);

  if (googleVerifier) {
    container.registerInstance('googleTokenVerifier', googleVerifier);
  }

  const app = createApp(container);
  return { app, container };
}

module.exports = { buildTestApp };
