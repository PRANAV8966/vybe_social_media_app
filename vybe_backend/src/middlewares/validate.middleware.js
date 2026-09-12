/**
 * Generic Joi-validation middleware factory. This is framework-level plumbing
 * (equivalent to using Joi/Express directly) — it has no awareness of any
 * feature module's error classes or response shape, so it is not a shared
 * domain base class. On failure it throws a small local error whose shape
 * (statusCode/code/toJSON) is duck-typed the same as every module's own error
 * classes, so the final fallback error handler renders it consistently.
 */
class RequestValidationError extends Error {
  constructor(details) {
    super('Request validation failed');
    this.name = 'RequestValidationError';
    this.code = 'VALIDATION_ERROR';
    this.statusCode = 400;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

/**
 * @param {import('joi').ObjectSchema} schema
 * @param {'body'|'query'|'params'} property
 */
function validate(schema, property = 'body') {
  return function validateMiddleware(req, res, next) {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const details = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));
      return next(new RequestValidationError(details));
    }

    req[property] = value;
    next();
  };
}

module.exports = { validate, RequestValidationError };
