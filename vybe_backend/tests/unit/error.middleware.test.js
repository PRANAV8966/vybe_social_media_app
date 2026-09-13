function loadMiddlewareWithEnv(isProduction) {
  jest.resetModules();
  jest.doMock('../../src/config/env', () => ({ isProduction }));
  jest.doMock('../../src/config/logger', () => ({ error: jest.fn(), warn: jest.fn() }));
  // eslint-disable-next-line global-require
  return require('../../src/middlewares/error.middleware');
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('finalErrorHandler', () => {
  afterEach(() => {
    jest.dontMock('../../src/config/env');
    jest.dontMock('../../src/config/logger');
  });

  it('hides the real message/details of an unexpected (500) error in production', () => {
    const { finalErrorHandler } = loadMiddlewareWithEnv(true);
    const err = new Error('Database name retryWrites=true&w=majority&appName=vybe is too long');
    const res = fakeRes();

    finalErrorHandler(err, {}, res, () => {});

    expect(res.statusCode).toBe(500);
    expect(res.body.error.message).toBe('Something went wrong. Please try again later.');
    expect(res.body.error.details).toBeNull();
  });

  it('exposes the real message and details of an unexpected (500) error outside production', () => {
    const { finalErrorHandler } = loadMiddlewareWithEnv(false);
    const err = new Error('Database name retryWrites=true&w=majority&appName=vybe is too long');
    err.name = 'MongoServerError';
    const res = fakeRes();

    finalErrorHandler(err, {}, res, () => {});

    expect(res.statusCode).toBe(500);
    expect(res.body.error.message).toBe('Database name retryWrites=true&w=majority&appName=vybe is too long');
    expect(res.body.error.details.name).toBe('MongoServerError');
    expect(res.body.error.details.stack).toEqual(expect.any(String));
  });

  it('always shows the real message for a known (< 500) domain error, in every environment', () => {
    for (const isProduction of [true, false]) {
      const { finalErrorHandler } = loadMiddlewareWithEnv(isProduction);
      const err = Object.assign(new Error('Post not found'), {
        statusCode: 404,
        code: 'POST_NOT_FOUND',
        toJSON: () => ({ details: { some: 'context' } }),
      });
      const res = fakeRes();

      finalErrorHandler(err, {}, res, () => {});

      expect(res.statusCode).toBe(404);
      expect(res.body.error.code).toBe('POST_NOT_FOUND');
      expect(res.body.error.message).toBe('Post not found');
      expect(res.body.error.details).toEqual({ some: 'context' });
    }
  });
});
