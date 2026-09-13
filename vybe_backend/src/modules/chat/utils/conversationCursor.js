/**
 * The conversation list is sorted by (lastMessageAt desc, _id desc) — a
 * mutable, non-unique-alone sort key (last-activity-first, matching how
 * every chat app orders its inbox) — so a plain _id cursor (as used for
 * posts/messages, which sort on an immutable key) isn't enough on its own;
 * the cursor must carry both fields to resume the same ordering unambiguously.
 */
function encodeConversationCursor(conversation) {
  const payload = {
    a: conversation.lastMessageAt ? new Date(conversation.lastMessageAt).getTime() : null,
    i: conversation._id.toString(),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeConversationCursor(cursor) {
  try {
    const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof payload.i !== 'string' || (payload.a !== null && typeof payload.a !== 'number')) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

module.exports = { encodeConversationCursor, decodeConversationCursor };
