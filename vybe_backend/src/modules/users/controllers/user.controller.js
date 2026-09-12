const userResponse = require('../dto/responses/user.response');

class UserController {
  constructor(userService) {
    this.userService = userService;

    this.getMe = this.getMe.bind(this);
    this.updateMe = this.updateMe.bind(this);
    this.getByUsername = this.getByUsername.bind(this);
    this.search = this.search.bind(this);
  }

  async getMe(req, res) {
    const { user, stats } = await this.userService.getMyProfile(req.user.id);
    res.status(200).json(userResponse.success(userResponse.toMeDTO(user, stats)));
  }

  async updateMe(req, res) {
    const { user, stats } = await this.userService.updateProfile(req.user.id, req.body);
    res.status(200).json(userResponse.success(userResponse.toMeDTO(user, stats), 'Profile updated'));
  }

  async getByUsername(req, res) {
    const { user, stats } = await this.userService.getPublicProfile(req.params.username);
    res.status(200).json(userResponse.success(userResponse.toProfileDTO(user, stats)));
  }

  async search(req, res) {
    const { q, cursor, limit } = req.query;
    const { users, nextCursor } = await this.userService.search(q, { cursor: cursor || null, limit });
    res.status(200).json(
      userResponse.success({
        users: users.map(({ user, stats }) => userResponse.toProfileDTO(user, stats)),
        nextCursor,
      }),
    );
  }
}

module.exports = { UserController };
