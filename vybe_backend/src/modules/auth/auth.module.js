const { RefreshTokenRepository } = require('./repositories/refreshToken.repository');
const { GoogleTokenVerifier } = require('./utils/googleVerifier.util');
const { AuthService } = require('./services/auth.service');
const { AuthController } = require('./controllers/auth.controller');
const env = require('../../config/env');

function registerAuthModule(container) {
  container.registerSingleton('refreshTokenRepository', () => new RefreshTokenRepository());
  container.registerSingleton('googleTokenVerifier', () => new GoogleTokenVerifier());
  container.registerSingleton(
    'authService',
    (c) =>
      new AuthService(
        c.resolve('userRepository'),
        c.resolve('userStatsRepository'),
        c.resolve('refreshTokenRepository'),
        c.resolve('googleTokenVerifier'),
      ),
  );
  container.registerSingleton('authController', (c) => new AuthController(c.resolve('authService'), env));
}

module.exports = { registerAuthModule };
