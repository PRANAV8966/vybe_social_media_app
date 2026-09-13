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

/**
 * Shapes a User doc + its UserStats doc into the public-facing profile
 * object. Never trust the caller to have stripped passwordHash — this is the
 * single place that decides what a "profile" looks like on the wire.
 */
function toProfileDTO(user, stats, extra = {}) {
  return {
    id: user._id.toString(),
    name: user.name,
    username: user.username,
    bio: user.bio,
    profilePhotoUrl: user.profilePhotoUrl,
    country: user.country,
    isPrivate: user.isPrivate,
    followersCount: stats?.followersCount ?? 0,
    followingCount: stats?.followingCount ?? 0,
    postsCount: stats?.postsCount ?? 0,
    createdAt: user.createdAt,
    ...extra,
  };
}

/** Includes email — only ever used for the "me" endpoint, never for public profiles. */
function toMeDTO(user, stats) {
  return {
    ...toProfileDTO(user, stats),
    email: user.email,
    authProvider: user.authProvider,
  };
}

module.exports = { success, error, toProfileDTO, toMeDTO };
