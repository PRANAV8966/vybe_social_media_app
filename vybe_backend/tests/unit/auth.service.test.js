const { AuthService } = require('../../src/modules/auth/services/auth.service');
const { AccountLockedError, InvalidCredentialsError } = require('../../src/modules/auth/errors/auth.errors');

jest.mock('../../src/modules/auth/utils/password.util', () => ({
  hashPassword: jest.fn(),
  verifyPassword: jest.fn(),
}));
const { verifyPassword } = require('../../src/modules/auth/utils/password.util');

function makeUser(overrides = {}) {
  return {
    _id: 'user-1',
    authProvider: 'local',
    isActive: true,
    passwordHash: 'hash',
    failedLoginAttempts: 0,
    lockedUntil: null,
    ...overrides,
  };
}

describe('AuthService.login lockout behavior (unit, mocked repositories)', () => {
  let userRepository;
  let refreshTokenRepository;
  let service;

  beforeEach(() => {
    userRepository = {
      findByEmail: jest.fn(),
      incrementFailedLoginAttempts: jest.fn(),
      lockAccount: jest.fn(),
      resetFailedLogins: jest.fn(),
    };
    refreshTokenRepository = { create: jest.fn().mockResolvedValue({}) };
    service = new AuthService(userRepository, {}, refreshTokenRepository, {});
    verifyPassword.mockReset();
  });

  it('throws AccountLockedError without attempting password verification while still locked', async () => {
    userRepository.findByEmail.mockResolvedValue(makeUser({ lockedUntil: new Date(Date.now() + 60000) }));

    await expect(service.login({ email: 'a@example.com', password: 'x' })).rejects.toBeInstanceOf(AccountLockedError);
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it('grants a fresh attempt budget once a previous lock has expired, instead of instantly re-locking', async () => {
    userRepository.findByEmail.mockResolvedValue(
      makeUser({ lockedUntil: new Date(Date.now() - 1000), failedLoginAttempts: 3 }),
    );
    verifyPassword.mockResolvedValue(false);
    userRepository.incrementFailedLoginAttempts.mockResolvedValue({ failedLoginAttempts: 1 });

    await expect(service.login({ email: 'a@example.com', password: 'wrong' })).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(userRepository.resetFailedLogins).toHaveBeenCalledWith('user-1');
    expect(userRepository.lockAccount).not.toHaveBeenCalled();
  });

  it('locks the account once failedLoginAttempts reaches the configured max', async () => {
    userRepository.findByEmail.mockResolvedValue(makeUser({ failedLoginAttempts: 2 }));
    verifyPassword.mockResolvedValue(false);
    userRepository.incrementFailedLoginAttempts.mockResolvedValue({ failedLoginAttempts: 3 }); // test env max = 3

    await expect(service.login({ email: 'a@example.com', password: 'wrong' })).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(userRepository.lockAccount).toHaveBeenCalledWith('user-1', expect.any(Date));
  });

  it('resets the failed-attempt counter on a successful login', async () => {
    userRepository.findByEmail.mockResolvedValue(makeUser());
    verifyPassword.mockResolvedValue(true);

    const { user } = await service.login({ email: 'a@example.com', password: 'correct' });

    expect(user._id).toBe('user-1');
    expect(userRepository.resetFailedLogins).toHaveBeenCalledWith('user-1');
  });
});
