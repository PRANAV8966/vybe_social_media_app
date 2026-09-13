const logger = require('../config/logger');
const env = require('../config/env');

/**
 * Catch-all for routes that don't match anything. Mounted after every
 * module's router.
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: { code: 'ROUTE_NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}`, details: null },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Final safety net. Every module owns and renders its own errors via its own
 * response DTO (see each module's own "<name>.error-handler.js") — this
 * handler only runs for whatever nothing else caught: unexpected exceptions,
 * errors thrown by generic infra middleware (e.g. request validation), etc.
 *
 * It never imports a module's error classes; it only duck-types on the shape
 * every module's own errors independently agree to expose
 * ({ statusCode, code, message, toJSON() }), which is how consistent output
 * is achieved without a shared inheritance hierarchy.
 */
// eslint-disable-next-line no-unused-vars
function finalErrorHandler(err, req, res, next) {
  const hasKnownShape = typeof err.statusCode === 'number';
  const statusCode = hasKnownShape ? err.statusCode : 500;
  const isServerFault = statusCode >= 500;

  if (isServerFault) {
    logger.error({ err }, 'Unhandled error');
  } else {
    logger.warn({ err: { name: err.name, message: err.message } }, 'Request error');
  }

  const code = (!isServerFault && err.code) || 'INTERNAL_ERROR';

  // Production hides the real 500 message/cause on purpose (an unexpected
  // error is, by definition, one we haven't vetted for safe disclosure — it
  // could be a raw driver/DB error quoting connection internals, as happened
  // here). Every other environment shows the real thing, because a generic
  // "something went wrong" in your own local dev logs helps nobody.
  const message = isServerFault
    ? env.isProduction
      ? 'Something went wrong. Please try again later.'
      : err.message || 'Unexpected error'
    : err.message || 'Request failed';
  const details = isServerFault
    ? env.isProduction
      ? null
      : { name: err.name, stack: err.stack }
    : typeof err.toJSON === 'function'
      ? err.toJSON().details ?? null
      : null;

  res.status(statusCode).json({
    success: false,
    error: { code, message, details },
    timestamp: new Date().toISOString(),
  });
}

module.exports = { notFoundHandler, finalErrorHandler };
