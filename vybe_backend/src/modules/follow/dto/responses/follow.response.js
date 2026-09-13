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

function toFollowStatusDTO(isFollowing) {
  return { following: isFollowing };
}

module.exports = { success, error, toUserSummaryDTO, toFollowStatusDTO };
