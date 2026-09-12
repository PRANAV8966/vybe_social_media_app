const { UserRepository } = require('./repositories/user.repository');
const { UserStatsRepository } = require('./repositories/userStats.repository');
const { UserService } = require('./services/user.service');
const { UserController } = require('./controllers/user.controller');

function registerUsersModule(container) {
  container.registerSingleton('userRepository', () => new UserRepository());
  container.registerSingleton('userStatsRepository', () => new UserStatsRepository());
  container.registerSingleton(
    'userService',
    (c) => new UserService(c.resolve('userRepository'), c.resolve('userStatsRepository')),
  );
  container.registerSingleton('userController', (c) => new UserController(c.resolve('userService')));
}

module.exports = { registerUsersModule };
