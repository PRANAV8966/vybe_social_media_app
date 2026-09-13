const { ChatError } = require('../errors/chat.errors');
const { UserError } = require('../../users/errors/user.errors');
const chatResponse = require('../dto/responses/chat.response');

// eslint-disable-next-line no-unused-vars
function chatErrorHandler(err, req, res, next) {
  if (err instanceof ChatError || err instanceof UserError) {
    return res.status(err.statusCode).json(chatResponse.error(err));
  }
  next(err);
}

module.exports = chatErrorHandler;
