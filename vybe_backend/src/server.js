const http = require('http');
const { Server } = require('socket.io');
const env = require('./config/env');
const logger = require('./config/logger');
const { connectDB, disconnectDB } = require('./config/db');
const { checkS3Access } = require('./config/s3');
const Container = require('./container/Container');
const { createApp } = require('./app');

const { registerUsersModule } = require('./modules/users/user.module');
const { registerAuthModule } = require('./modules/auth/auth.module');
const { registerPostsModule } = require('./modules/posts/post.module');
const { registerFollowModule } = require('./modules/follow/follow.module');
const { registerChatModule } = require('./modules/chat/chat.module');
const { registerChatSocketHandlers } = require('./modules/chat/socket/registerChatSocketHandlers');

async function start() {
  // Independent startup checks — MongoDB connectivity is required (fails
  // fast, see assertReplicaSet), S3 connectivity is advisory-only (see
  // checkS3Access) — nothing about the other depends on either's result.
  await Promise.all([connectDB(), checkS3Access()]);

  const container = new Container();
  // Registration order is independent of resolution order — every module's
  // dependencies are resolved lazily on first use, not at registration time.
  // Chat has a hard (non-optional) dependency on Follow's repository, so
  // Follow must be registered before createApp() below resolves chat's
  // routes — resolution, not registration, is what actually needs the order.
  registerUsersModule(container);
  registerAuthModule(container);
  registerFollowModule(container);
  registerPostsModule(container);
  registerChatModule(container);

  const app = createApp(container);

  // Created separately from the app (rather than http.createServer(app)) so
  // Socket.IO can attach to it — see chatGateway.js for why chatGateway is
  // wired up (attachIo) only after this point, not at DI-construction time.
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: env.clientOrigins },
    // Replays events missed during a brief disconnect (default: up to 2
    // minutes) using the in-memory adapter's own buffer — no application
    // code needed. `skipMiddlewares: true` (the default) means a recovered
    // connection does NOT re-run socketAuthMiddleware; this is intentional
    // and bounded — it only applies to the same already-authenticated
    // session resuming within the recovery window, never a new handshake.
    connectionStateRecovery: {},
  });
  container.resolve('chatGateway').attachIo(io);
  registerChatSocketHandlers(io, container);

  httpServer.listen(env.port, () => {
    logger.info(`Vybe backend listening on port ${env.port} (${env.nodeEnv})`);
  });

  const shutdown = async (signal) => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    // io.close() also closes the httpServer it was attached to (Socket.IO
    // waits for that close to complete before resolving) — a separate
    // httpServer.close() call here would be redundant.
    await io.close();
    await disconnectDB();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { app, server: httpServer, io, container };
}

if (require.main === module) {
  start().catch((err) => {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  });
}

module.exports = { start };
