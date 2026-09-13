const path = require('path');
const multer = require('multer');
const env = require('../../../config/env');
const { UnsupportedPostMediaError, PostMediaTooLargeError } = require('../errors/post.errors');

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm', '.mov']);

const upload = multer({
  storage: multer.memoryStorage(),
  // The multer-level ceiling is the higher (video) limit — a hard cutoff.
  // Image-specific size enforcement happens after the real type is known
  // (see PostMediaStorage.validate), since fileFilter can't yet tell.
  limits: { fileSize: env.uploads.videoMaxBytes, files: 1 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new UnsupportedPostMediaError());
    }
    cb(null, true);
  },
});

function postMediaUpload(req, res, next) {
  upload.single('media')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new PostMediaTooLargeError('video', env.uploads.videoMaxBytes));
      }
      // Any other multer-level rejection (wrong field name, too many files,
      // etc.) — MulterError has no statusCode of its own, so left unhandled
      // it would fall through to a generic 500 instead of a clear 400.
      return next(new UnsupportedPostMediaError());
    }
    if (err) return next(err);
    next();
  });
}

module.exports = { postMediaUpload };
