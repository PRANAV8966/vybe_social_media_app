const path = require('path');
const multer = require('multer');
const env = require('../../../config/env');
const { InvalidProfilePhotoError, ProfilePhotoTooLargeError } = require('../errors/user.errors');

const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.uploads.imageMaxBytes, files: 1 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new InvalidProfilePhotoError());
    }
    cb(null, true);
  },
});

/**
 * This is only a coarse, cheap pre-filter on the client-claimed
 * mimetype/extension (multer's fileFilter never sees the file body, only its
 * headers). The authoritative check is the magic-byte sniff in
 * ProfilePhotoStorage.validate(), run once the buffer is fully available.
 */
function profilePhotoUpload(req, res, next) {
  upload.single('photo')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ProfilePhotoTooLargeError(env.uploads.imageMaxBytes));
      }
      // Any other multer-level rejection (wrong field name, too many files,
      // etc.) — MulterError has no statusCode of its own, so left unhandled
      // it would fall through to a generic 500 instead of a clear 400.
      return next(new InvalidProfilePhotoError());
    }
    if (err) return next(err);
    next();
  });
}

module.exports = { profilePhotoUpload };
