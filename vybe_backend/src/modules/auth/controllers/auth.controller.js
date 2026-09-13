const authResponse = require('../dto/responses/auth.response');

class AuthController {
  constructor(authService) {
    this.authService = authService;

    this.register = this.register.bind(this);
    this.login = this.login.bind(this);
    this.google = this.google.bind(this);
    this.refresh = this.refresh.bind(this);
    this.logout = this.logout.bind(this);
  }

  _requestMeta(req) {
    return { userAgent: req.headers['user-agent'] || null, ip: req.ip };
  }

  async register(req, res) {
    const { user, tokens } = await this.authService.register(req.body, this._requestMeta(req));
    res.status(201).json(
      authResponse.success(
        { user: authResponse.toAuthenticatedUserDTO(user), accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
        'Registered successfully',
      ),
    );
  }

  async login(req, res) {
    const { user, tokens } = await this.authService.login(req.body, this._requestMeta(req));
    res.status(200).json(
      authResponse.success(
        { user: authResponse.toAuthenticatedUserDTO(user), accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
        'Logged in successfully',
      ),
    );
  }

  async google(req, res) {
    const { user, tokens } = await this.authService.loginWithGoogle(req.body.idToken, this._requestMeta(req));
    res.status(200).json(
      authResponse.success(
        { user: authResponse.toAuthenticatedUserDTO(user), accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
        'Logged in successfully',
      ),
    );
  }

  async refresh(req, res) {
    const { accessToken, refreshToken } = await this.authService.refresh(req.body.refreshToken);
    res.status(200).json(authResponse.success({ accessToken, refreshToken }));
  }

  async logout(req, res) {
    await this.authService.logout(req.body.refreshToken);
    res.status(200).json(authResponse.success(null, 'Logged out successfully'));
  }
}

module.exports = { AuthController };
