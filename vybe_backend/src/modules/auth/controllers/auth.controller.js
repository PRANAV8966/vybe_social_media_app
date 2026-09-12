const authResponse = require('../dto/responses/auth.response');

const REFRESH_COOKIE_NAME = 'refreshToken';

function refreshCookieOptions(isProduction) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/api/v1/auth',
    signed: true,
  };
}

class AuthController {
  constructor(authService, env) {
    this.authService = authService;
    this.env = env;

    this.register = this.register.bind(this);
    this.login = this.login.bind(this);
    this.google = this.google.bind(this);
    this.refresh = this.refresh.bind(this);
    this.logout = this.logout.bind(this);
  }

  _requestMeta(req) {
    return { userAgent: req.headers['user-agent'] || null, ip: req.ip };
  }

  _setRefreshCookie(res, refreshToken) {
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(this.env.isProduction));
  }

  async register(req, res) {
    const { user, tokens } = await this.authService.register(req.body, this._requestMeta(req));
    this._setRefreshCookie(res, tokens.refreshToken);
    res.status(201).json(
      authResponse.success({ user: authResponse.toAuthenticatedUserDTO(user), accessToken: tokens.accessToken }, 'Registered successfully'),
    );
  }

  async login(req, res) {
    const { user, tokens } = await this.authService.login(req.body, this._requestMeta(req));
    this._setRefreshCookie(res, tokens.refreshToken);
    res.status(200).json(
      authResponse.success({ user: authResponse.toAuthenticatedUserDTO(user), accessToken: tokens.accessToken }, 'Logged in successfully'),
    );
  }

  async google(req, res) {
    const { user, tokens } = await this.authService.loginWithGoogle(req.body.idToken, this._requestMeta(req));
    this._setRefreshCookie(res, tokens.refreshToken);
    res.status(200).json(
      authResponse.success({ user: authResponse.toAuthenticatedUserDTO(user), accessToken: tokens.accessToken }, 'Logged in successfully'),
    );
  }

  async refresh(req, res) {
    const rawRefreshToken = req.signedCookies?.[REFRESH_COOKIE_NAME];
    const { accessToken, refreshToken } = await this.authService.refresh(rawRefreshToken);
    this._setRefreshCookie(res, refreshToken);
    res.status(200).json(authResponse.success({ accessToken }));
  }

  async logout(req, res) {
    const rawRefreshToken = req.signedCookies?.[REFRESH_COOKIE_NAME];
    await this.authService.logout(rawRefreshToken);
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions(this.env.isProduction));
    res.status(200).json(authResponse.success(null, 'Logged out successfully'));
  }
}

module.exports = { AuthController, REFRESH_COOKIE_NAME };
