const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');
const env = require('./env');
const logger = require('./logger');

/**
 * Credentials are never read here — the SDK's default provider chain resolves
 * them from AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY env vars, a shared config
 * file, or an IAM role, in that order. Nothing in this codebase should ever
 * hardcode a key/secret.
 */
const s3Client = new S3Client({ region: env.s3.region });

/**
 * Deliberately a soft check (warn, never crash the process): unlike MongoDB,
 * nothing else in the app depends on S3 to function — a misconfigured
 * bucket/region/IAM policy should only break uploads, not registration,
 * login, or reading posts. This just surfaces that misconfiguration at boot
 * instead of waiting for the first real upload attempt to discover it.
 */
async function checkS3Access() {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: env.s3.bucket }));
    logger.info({ bucket: env.s3.bucket }, 'S3 bucket reachable');
  } catch (err) {
    logger.warn(
      { err, bucket: env.s3.bucket, region: env.s3.region },
      'Could not verify S3 bucket access at startup — uploads will fail until this is fixed (check bucket name, region, and IAM permissions)',
    );
  }
}

module.exports = { s3Client, checkS3Access };
