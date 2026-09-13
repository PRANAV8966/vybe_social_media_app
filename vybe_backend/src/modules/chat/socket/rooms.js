/** Room-naming conventions shared between the ChatGateway (server -> client) and the connection handlers (client -> server). */
function conversationRoom(conversationId) {
  return `conversation:${conversationId}`;
}

/** Doubles as the presence room — "is user X online" is answered by "does room user:X have any sockets in it", across the whole cluster once a distributed adapter is in use (see ChatGateway.isOnline). */
function userRoom(userId) {
  return `user:${userId}`;
}

module.exports = { conversationRoom, userRoom };
