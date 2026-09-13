const { OAuth2Client } = require('google-auth-library');
const env = require('../../../config/env');

class GoogleTokenVerifier {
  constructor(clientId = env.googleClientId) {
    this.clientId = clientId;
    this.client = new OAuth2Client();
  }

  /**
   * Verifies signature/issuer/audience/expiry (verifyIdToken itself throws on
   * any mismatch) and returns the trusted profile fields. Google is only
   * authoritative for the email address when it has verified it — never
   * trust an unverified email for account linking or creation.
   * @returns {{ googleId: string, email: string, emailVerified: boolean, name: string, profilePhotoUrl: string }}
   */
  async verify(idToken) {
    const ticket = await this.client.verifyIdToken({ idToken, audience: this.clientId });
    const payload = ticket.getPayload();
    return {
      googleId: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      name: payload.name || payload.email.split('@')[0],
      profilePhotoUrl: payload.picture || '',
    };
  }
}

module.exports = { GoogleTokenVerifier };
