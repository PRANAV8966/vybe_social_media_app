const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const pinoHttp = require('pino-http');

const env = require('./config/env');
const logger = require('./config/logger');
const { generalLimiter } = require('./middlewares/rateLimit.middleware');
const { notFoundHandler, finalErrorHandler } = require('./middlewares/error.middleware');

const { buildAuthRoutes } = require('./modules/auth/auth.routes');
const authErrorHandler = require('./modules/auth/middlewares/auth.error-handler');
const { buildUserRoutes } = require('./modules/users/user.routes');
const usersErrorHandler = require('./modules/users/middlewares/users.error-handler');
const { buildPostRoutes } = require('./modules/posts/post.routes');
const postsErrorHandler = require('./modules/posts/middlewares/posts.error-handler');
const { buildFollowRoutes } = require('./modules/follow/follow.routes');
const followErrorHandler = require('./modules/follow/middlewares/follow.error-handler');
const { buildChatRoutes } = require('./modules/chat/chat.routes');
const chatErrorHandler = require('./modules/chat/middlewares/chat.error-handler');

function createApp(container) {
  const app = express();

  if (env.isProduction) {
    // Trust exactly one reverse-proxy hop (e.g. a load balancer) so req.ip and
    // the rate limiter's IP-based keying reflect the real client, not the proxy.
    app.set('trust proxy', 1);
  }

  app.use(helmet());
  // No `credentials: true` — auth tokens travel in the request/response body
  // (Authorization header + JSON), not cookies, so there's nothing that
  // needs cross-origin credentialed requests.
  app.use(cors({ origin: env.clientOrigins }));
  app.use(express.json({ limit: '1mb' }));
  app.use(compression());
  app.use(pinoHttp({ logger, autoLogging: !env.isTest }));
  app.use(generalLimiter);

  app.use('/api/v1/auth', buildAuthRoutes(container), authErrorHandler);
  app.use('/api/v1/users', buildUserRoutes(container), usersErrorHandler);
  app.use('/api/v1/posts', buildPostRoutes(container), postsErrorHandler);
  app.use('/api/v1/follow', buildFollowRoutes(container), followErrorHandler);
  app.use('/api/v1/chat', buildChatRoutes(container), chatErrorHandler);

  app.use(notFoundHandler);
  app.use(finalErrorHandler);

  return app;
}

module.exports = { createApp };
