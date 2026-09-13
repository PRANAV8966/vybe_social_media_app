const postResponse = require('../dto/responses/post.response');

class PostController {
  constructor(postService) {
    this.postService = postService;

    this.create = this.create.bind(this);
    this.edit = this.edit.bind(this);
    this.remove = this.remove.bind(this);
    this.getById = this.getById.bind(this);
    this.getByUsername = this.getByUsername.bind(this);
  }

  async create(req, res) {
    const { text, clientRequestId } = req.body;
    const { post, created } = await this.postService.createPost({
      authorId: req.user.id,
      text,
      clientRequestId,
      file: req.file,
    });
    res.status(created ? 201 : 200).json(postResponse.success(postResponse.toPostDTO(post), created ? 'Post created' : 'Post already created'));
  }

  async edit(req, res) {
    const post = await this.postService.editPost({
      postId: req.params.postId,
      authorId: req.user.id,
      text: req.body.text,
      file: req.file,
    });
    res.status(200).json(postResponse.success(postResponse.toPostDTO(post), 'Post updated'));
  }

  async remove(req, res) {
    await this.postService.deletePost({ postId: req.params.postId, authorId: req.user.id });
    res.status(200).json(postResponse.success(null, 'Post deleted'));
  }

  async getById(req, res) {
    const post = await this.postService.getPostById({ postId: req.params.postId, requesterId: req.user.id });
    res.status(200).json(postResponse.success(postResponse.toPostDTO(post)));
  }

  async getByUsername(req, res) {
    const { cursor, limit } = req.query;
    const result = await this.postService.getUserPosts({
      username: req.params.username,
      requesterId: req.user.id,
      cursor: cursor || null,
      limit,
    });

    if (result.gated) {
      return res.status(200).json(
        postResponse.success({ isPrivate: true, isFollowing: result.isFollowing, posts: [], nextCursor: null }),
      );
    }

    res.status(200).json(
      postResponse.success({
        isPrivate: false,
        posts: result.posts.map(postResponse.toPostDTO),
        nextCursor: result.nextCursor,
      }),
    );
  }
}

module.exports = { PostController };
