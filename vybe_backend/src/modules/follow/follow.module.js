const { FollowRepository } = require('./repositories/follow.repository');
const { FollowService } = require('./services/follow.service');
const { FollowController } = require('./controllers/follow.controller');

function registerFollowModule(container) {
  container.registerSingleton('followRepository', () => new FollowRepository());
  container.registerSingleton(
    'followService',
    (c) => new FollowService(c.resolve('followRepository'), c.resolve('userRepository'), c.resolve('userStatsRepository')),
  );
  container.registerSingleton('followController', (c) => new FollowController(c.resolve('followService')));
}

module.exports = { registerFollowModule };
