const env = require('./config/env');
const logger = require('./config/logger');
const { connectDB, disconnectDB } = require('./config/db');
const Container = require('./container/Container');
const { createApp } = require('./app');

const { registerUsersModule } = require('./modules/users/user.module');
const { registerAuthModule } = require('./modules/auth/auth.module');
const { registerPostsModule } = require('./modules/posts/post.module');

async function start() {
  await connectDB();

  const container = new Container();
  // Registration order is independent of resolution order — every module's
  // dependencies are resolved lazily on first use, not at registration time.
  registerUsersModule(container);
  registerAuthModule(container);
  registerPostsModule(container);

  const app = createApp(container);

  const server = app.listen(env.port, () => {
    logger.info(`Vybe backend listening on port ${env.port} (${env.nodeEnv})`);
  });

  const shutdown = async (signal) => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { app, server, container };
}

if (require.main === module) {
  start().catch((err) => {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  });
}

module.exports = { start };
