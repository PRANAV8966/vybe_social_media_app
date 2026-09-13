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

function toAuthenticatedUserDTO(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    username: user.username,
    email: user.email,
    authProvider: user.authProvider,
    profilePhotoUrl: user.profilePhotoUrl,
    // Only present for Google-linked accounts — mirrors bepay's GlobalUserDTO convention of
    // conditionally including the provider id rather than always sending it as null.
    ...(user.googleId ? { googleId: user.googleId } : {}),
  };
}

module.exports = { success, error, toAuthenticatedUserDTO };
