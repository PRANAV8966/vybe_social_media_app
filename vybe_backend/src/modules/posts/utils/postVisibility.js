/**
 * Shared by PostService and LikeService (module-internal only — this is
 * "no sharing between modules," not "no code reuse within one"). A private
 * account's posts — and by extension, liking them — are visible only to the
 * owner or an approved follower. Fails closed if followRepository isn't
 * wired in yet: nobody can be a "follower" of anyone, so a private account
 * is only visible to itself.
 */
async function isFollowingUser(followRepository, followerId, followingId) {
  if (!followRepository || !followerId) {
    return false;
  }
  return followRepository.exists(followerId, followingId);
}

async function resolveVisibility(followRepository, targetUser, requesterId) {
  const isOwner = Boolean(requesterId) && String(targetUser._id) === String(requesterId);
  if (isOwner || !targetUser.isPrivate) {
    return { canView: true, isFollowing: false };
  }
  const isFollowing = await isFollowingUser(followRepository, requesterId, targetUser._id);
  return { canView: isFollowing, isFollowing };
}

module.exports = { resolveVisibility, isFollowingUser };
