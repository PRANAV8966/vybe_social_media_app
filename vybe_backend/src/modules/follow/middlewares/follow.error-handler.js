const { FollowError } = require('../errors/follow.errors');
const { UserError } = require('../../users/errors/user.errors');
const followResponse = require('../dto/responses/follow.response');

// eslint-disable-next-line no-unused-vars
function followErrorHandler(err, req, res, next) {
  if (err instanceof FollowError || err instanceof UserError) {
    return res.status(err.statusCode).json(followResponse.error(err));
  }
  next(err);
}

module.exports = followErrorHandler;
