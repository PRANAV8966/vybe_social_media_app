const userResponse = require('../dto/responses/user.response');
const { InvalidProfilePhotoError } = require('../errors/user.errors');

class UserController {
  constructor(userService) {
    this.userService = userService;

    this.getMe = this.getMe.bind(this);
    this.updateMe = this.updateMe.bind(this);
    this.getByUsername = this.getByUsername.bind(this);
    this.search = this.search.bind(this);
    this.uploadProfilePhoto = this.uploadProfilePhoto.bind(this);
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

  async uploadProfilePhoto(req, res) {
    if (!req.file) {
      throw new InvalidProfilePhotoError('No photo file was provided');
    }
    const { user, stats } = await this.userService.updateProfilePhoto(req.user.id, req.file);
    res.status(200).json(userResponse.success(userResponse.toMeDTO(user, stats), 'Profile photo updated'));
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
