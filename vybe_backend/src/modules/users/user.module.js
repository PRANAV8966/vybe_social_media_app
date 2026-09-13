const { UserRepository } = require('./repositories/user.repository');
const { UserStatsRepository } = require('./repositories/userStats.repository');
const { UserService } = require('./services/user.service');
const { UserController } = require('./controllers/user.controller');
const { ProfilePhotoStorage } = require('./storage/profilePhotoStorage');
const { s3Client } = require('../../config/s3');
const env = require('../../config/env');

function registerUsersModule(container) {
  container.registerSingleton('userRepository', () => new UserRepository());
  container.registerSingleton('userStatsRepository', () => new UserStatsRepository());
  container.registerSingleton(
    'profilePhotoStorage',
    () =>
      new ProfilePhotoStorage(s3Client, {
        bucket: env.s3.bucket,
        region: env.s3.region,
        cdnBaseUrl: env.s3.cdnBaseUrl,
        maxBytes: env.uploads.imageMaxBytes,
      }),
  );
  container.registerSingleton(
    'userService',
    (c) => new UserService(c.resolve('userRepository'), c.resolve('userStatsRepository'), c.resolve('profilePhotoStorage')),
  );
  container.registerSingleton('userController', (c) => new UserController(c.resolve('userService')));
}

module.exports = { registerUsersModule };
