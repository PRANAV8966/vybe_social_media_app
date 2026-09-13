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

function toAuthorDTO(author) {
  if (!author || typeof author === 'string') {
    return { id: String(author) };
  }
  return {
    id: author._id.toString(),
    username: author.username,
    name: author.name,
    profilePhotoUrl: author.profilePhotoUrl,
  };
}

function toPostDTO(post) {
  return {
    id: post._id.toString(),
    author: toAuthorDTO(post.author),
    text: post.text,
    mediaUrl: post.mediaUrl,
    mediaType: post.mediaType,
    likesCount: post.likesCount,
    // Undefined (not just falsy) whenever the caller didn't attach it — e.g.
    // a code path with no requester context — rather than silently lying "false".
    isLiked: post.isLiked === undefined ? undefined : Boolean(post.isLiked),
    isEdited: Boolean(post.editedAt),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

function toLikeStateDTO({ liked, likesCount }) {
  return { liked, likesCount };
}

module.exports = { success, error, toPostDTO, toLikeStateDTO };
