const { UserError } = require('../errors/user.errors');
const userResponse = require('../dto/responses/user.response');

// eslint-disable-next-line no-unused-vars
function usersErrorHandler(err, req, res, next) {
  if (err instanceof UserError) {
    return res.status(err.statusCode).json(userResponse.error(err));
  }
  next(err);
}

module.exports = usersErrorHandler;
