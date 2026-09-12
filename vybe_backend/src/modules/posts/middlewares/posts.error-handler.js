const { PostError } = require('../errors/post.errors');
const { UserError } = require('../../users/errors/user.errors');
const postResponse = require('../dto/responses/post.response');

// eslint-disable-next-line no-unused-vars
function postsErrorHandler(err, req, res, next) {
  if (err instanceof PostError || err instanceof UserError) {
    return res.status(err.statusCode).json(postResponse.error(err));
  }
  next(err);
}

module.exports = postsErrorHandler;
