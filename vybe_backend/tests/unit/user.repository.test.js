const { UserRepository } = require('../../src/modules/users/repositories/user.repository');

describe('UserRepository (uniqueness at the DB level)', () => {
  const repository = new UserRepository();

  function baseUser(overrides = {}) {
    return {
      name: 'Test User',
      username: 'testuser',
      email: 'test@example.com',
      passwordHash: 'hash',
      authProvider: 'local',
      ...overrides,
    };
  }

  it('rejects a duplicate email even with a different username', async () => {
    await repository.create(baseUser());
    await expect(repository.create(baseUser({ username: 'different' }))).rejects.toMatchObject({ code: 11000 });
  });

  it('rejects a duplicate username even with a different email', async () => {
    await repository.create(baseUser());
    await expect(repository.create(baseUser({ email: 'different@example.com' }))).rejects.toMatchObject({ code: 11000 });
  });

  it('allows multiple users with no googleId (sparse index)', async () => {
    await repository.create(baseUser({ email: 'a@example.com', username: 'usera' }));
    await expect(repository.create(baseUser({ email: 'b@example.com', username: 'userb' }))).resolves.toBeDefined();
  });

  it('rejects a duplicate googleId', async () => {
    await repository.create(baseUser({ email: 'a@example.com', username: 'usera', authProvider: 'google', googleId: 'g-1', passwordHash: undefined }));
    await expect(
      repository.create({ name: 'X', email: 'b@example.com', username: 'userb', authProvider: 'google', googleId: 'g-1' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('incrementFailedLoginAttempts is atomic and returns the updated count', async () => {
    const user = await repository.create(baseUser());
    const updated = await repository.incrementFailedLoginAttempts(user._id);
    expect(updated.failedLoginAttempts).toBe(1);
    const updatedAgain = await repository.incrementFailedLoginAttempts(user._id);
    expect(updatedAgain.failedLoginAttempts).toBe(2);
  });

  it('search matches by username prefix and by name substring, case-insensitively for name', async () => {
    await repository.create(baseUser({ name: 'Alice Smith', username: 'alice', email: 'alice@example.com' }));
    await repository.create(baseUser({ name: 'Bob Jones', username: 'bob', email: 'bob@example.com' }));

    const byPrefix = await repository.search('ali', { cursor: null, limit: 10 });
    expect(byPrefix.map((u) => u.username)).toContain('alice');

    const byName = await repository.search('smith', { cursor: null, limit: 10 });
    expect(byName.map((u) => u.username)).toContain('alice');
  });
});
