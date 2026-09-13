const followResponse = require('../dto/responses/follow.response');

class FollowController {
  constructor(followService) {
    this.followService = followService;

    this.follow = this.follow.bind(this);
    this.unfollow = this.unfollow.bind(this);
    this.getStatus = this.getStatus.bind(this);
    this.getFollowers = this.getFollowers.bind(this);
    this.getFollowing = this.getFollowing.bind(this);
  }

  async follow(req, res) {
    const result = await this.followService.follow(req.user.id, req.params.username);
    res.status(200).json(followResponse.success(followResponse.toFollowStatusDTO(result.following), 'Following'));
  }

  async unfollow(req, res) {
    const result = await this.followService.unfollow(req.user.id, req.params.username);
    res.status(200).json(followResponse.success(followResponse.toFollowStatusDTO(result.following), 'Unfollowed'));
  }

  async getStatus(req, res) {
    const result = await this.followService.getStatus(req.user.id, req.params.username);
    res.status(200).json(followResponse.success(followResponse.toFollowStatusDTO(result.following)));
  }

  async getFollowers(req, res) {
    const { cursor, limit } = req.query;
    const result = await this.followService.getFollowers(req.params.username, { cursor: cursor || null, limit });
    res.status(200).json(
      followResponse.success({ users: result.users.map(followResponse.toUserSummaryDTO), nextCursor: result.nextCursor }),
    );
  }

  async getFollowing(req, res) {
    const { cursor, limit } = req.query;
    const result = await this.followService.getFollowing(req.params.username, { cursor: cursor || null, limit });
    res.status(200).json(
      followResponse.success({ users: result.users.map(followResponse.toUserSummaryDTO), nextCursor: result.nextCursor }),
    );
  }
}

module.exports = { FollowController };
