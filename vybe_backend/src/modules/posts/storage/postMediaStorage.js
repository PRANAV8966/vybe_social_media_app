const crypto = require('crypto');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const logger = require('../../../config/logger');
const { detectMediaType } = require('../../../uploads/fileSignature');
const { UnsupportedPostMediaError, PostMediaTooLargeError } = require('../errors/post.errors');

const SAFE_CLIENT_REQUEST_ID = /^[a-zA-Z0-9_-]{1,100}$/;

class PostMediaStorage {
  /** @param {{send: Function}} s3Client - real AWS SDK v3 S3Client in production, a fake in tests. */
  constructor(s3Client, { bucket, region, cdnBaseUrl, imageMaxBytes, videoMaxBytes }) {
    this.s3Client = s3Client;
    this.bucket = bucket;
    this.region = region;
    this.cdnBaseUrl = cdnBaseUrl;
    this.imageMaxBytes = imageMaxBytes;
    this.videoMaxBytes = videoMaxBytes;
  }

  /** Verifies actual file content via magic bytes; size limit depends on the DETECTED type, not the client's claim. */
  validate(buffer, hintedMimeType) {
    const detected = detectMediaType(buffer, hintedMimeType);
    if (!detected) {
      throw new UnsupportedPostMediaError();
    }
    const limit = detected.mediaType === 'image' ? this.imageMaxBytes : this.videoMaxBytes;
    if (buffer.length > limit) {
      throw new PostMediaTooLargeError(detected.mediaType, limit);
    }
    return detected;
  }

  /**
   * When `clientRequestId` is supplied, the key is DETERMINISTIC — a retried
   * request for the same (author, clientRequestId) overwrites the same
   * object instead of orphaning a new one, mirroring the idempotency
   * guarantee already enforced at the DB layer for post creation.
   */
  async upload({ authorId, buffer, ext, contentType, clientRequestId }) {
    const safeId = clientRequestId && SAFE_CLIENT_REQUEST_ID.test(clientRequestId) ? clientRequestId : null;
    const key = `posts/${authorId}/${safeId ?? crypto.randomUUID()}.${ext}`;
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
      logger.warn({ err, key }, 'Failed to delete post media from S3 (non-fatal)');
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

module.exports = { PostMediaStorage };
