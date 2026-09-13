function success(data, message = null) {
  return { success: true, message, data, timestamp: new Date().toISOString() };
}

function error(err) {
  return {
    success: false,
    error: { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Something went wrong', details: err.details ?? null },
    timestamp: new Date().toISOString(),
  };
}

function toUserSummaryDTO(user) {
  if (!user || typeof user === 'string') {
    return { id: String(user) };
  }
  return {
    id: user._id.toString(),
    username: user.username,
    name: user.name,
    profilePhotoUrl: user.profilePhotoUrl,
  };
}

function _findParticipantState(conversation, userId) {
  return (conversation.participantState || []).find((state) => String(state.user) === String(userId));
}

function _otherParticipant(conversation, viewerId) {
  return (conversation.participants || []).find((p) => String(p._id || p) !== String(viewerId));
}

function toConversationDTO(conversation, viewerId) {
  const peer = _otherParticipant(conversation, viewerId);
  const myState = _findParticipantState(conversation, viewerId);
  return {
    id: conversation._id.toString(),
    peer: toUserSummaryDTO(peer),
    lastMessageText: conversation.lastMessageText,
    lastMessageAt: conversation.lastMessageAt,
    lastMessageBy: conversation.lastMessageBy ? conversation.lastMessageBy.toString() : null,
    myLastReadAt: myState ? myState.lastReadAt : null,
    createdAt: conversation.createdAt,
  };
}

/**
 * Tick state, computed at read time rather than stored — see
 * conversation.model.js for why. Only meaningful from the sender's own point
 * of view: comparing the message's timestamp against the OTHER participant's
 * watermarks tells the sender whether their message has been delivered/read.
 */
function _computeStatus(message, conversation) {
  // We want the *recipient's* watermarks, i.e. whichever participantState
  // entry does NOT belong to the message's own sender.
  const recipientState = (conversation.participantState || []).find(
    (state) => String(state.user) !== String(message.sender),
  );
  if (!recipientState) return 'sent';
  if (recipientState.lastReadAt && recipientState.lastReadAt >= message.createdAt) return 'read';
  if (recipientState.lastDeliveredAt && recipientState.lastDeliveredAt >= message.createdAt) return 'delivered';
  return 'sent';
}

function toMessageDTO(message, conversation) {
  return {
    id: message._id.toString(),
    conversation: message.conversation.toString(),
    sender: message.sender.toString(),
    content: message.content,
    clientMessageId: message.clientMessageId || null,
    status: conversation ? _computeStatus(message, conversation) : undefined,
    createdAt: message.createdAt,
  };
}

module.exports = { success, error, toUserSummaryDTO, toConversationDTO, toMessageDTO };
