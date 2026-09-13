const postResponse = require('../dto/responses/post.response');

class LikeController {
  constructor(likeService) {
    this.likeService = likeService;

    this.setLikeState = this.setLikeState.bind(this);
  }

  async setLikeState(req, res) {
    const { liked, likesCount } = await this.likeService.setLikeState({
      postId: req.params.postId,
      userId: req.user.id,
      liked: req.body.liked,
    });
    res
      .status(200)
      .json(postResponse.success(postResponse.toLikeStateDTO({ liked, likesCount }), liked ? 'Post liked' : 'Post unliked'));
  }
}

module.exports = { LikeController };
