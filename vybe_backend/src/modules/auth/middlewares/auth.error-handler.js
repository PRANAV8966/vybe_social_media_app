const { AuthError } = require('../errors/auth.errors');
const authResponse = require('../dto/responses/auth.response');

// eslint-disable-next-line no-unused-vars
function authErrorHandler(err, req, res, next) {
  if (err instanceof AuthError) {
    return res.status(err.statusCode).json(authResponse.error(err));
  }
  next(err);
}

module.exports = authErrorHandler;
