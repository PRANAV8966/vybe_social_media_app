const crypto = require('crypto');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const logger = require('../../../config/logger');
const { detectImageType } = require('../../../uploads/fileSignature');
const { InvalidProfilePhotoError, ProfilePhotoTooLargeError } = require('../errors/user.errors');

class ProfilePhotoStorage {
  /**
   * @param {{send: Function}} s3Client - anything shaped like an AWS SDK v3 S3Client (real client in
   *   production, a fake with a jest.fn() `send` in tests).
   */
  constructor(s3Client, { bucket, region, cdnBaseUrl, maxBytes }) {
    this.s3Client = s3Client;
    this.bucket = bucket;
    this.region = region;
    this.cdnBaseUrl = cdnBaseUrl;
    this.maxBytes = maxBytes;
  }

  /** Verifies actual file content via magic bytes — never trusts the client-supplied mimetype. */
  validate(buffer) {
    const detected = detectImageType(buffer);
    if (!detected) {
      throw new InvalidProfilePhotoError();
    }
    if (buffer.length > this.maxBytes) {
      throw new ProfilePhotoTooLargeError(this.maxBytes);
    }
    return detected;
  }

  async upload(userId, buffer, { ext, contentType }) {
    const key = `profile-photos/${userId}/${crypto.randomUUID()}.${ext}`;
    await this.s3Client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: contentType }),
    );
    return this._buildUrl(key);
  }

  /** Best-effort — an orphaned object is a storage-cost nuisance, never a correctness problem worth failing the request over. */
  async deleteByUrl(url) {
    const key = this._extractKey(url);
    if (!key) return;
    try {
      await this.s3Client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      logger.warn({ err, key }, 'Failed to delete old profile photo from S3 (non-fatal)');
    }
  }

  _buildUrl(key) {
    return this.cdnBaseUrl ? `${this.cdnBaseUrl}/${key}` : `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  _extractKey(url) {
    if (!url) return null;
    const prefix = this.cdnBaseUrl ? `${this.cdnBaseUrl}/` : `https://${this.bucket}.s3.${this.region}.amazonaws.com/`;
    return url.startsWith(prefix) ? url.slice(prefix.length) : null;
  }
}

module.exports = { ProfilePhotoStorage };
