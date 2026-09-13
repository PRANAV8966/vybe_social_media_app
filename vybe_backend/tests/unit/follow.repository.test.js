const mongoose = require('mongoose');
require('../../src/modules/users/models/user.model'); // registers User so populate() works
const { FollowRepository } = require('../../src/modules/follow/repositories/follow.repository');

describe('FollowRepository', () => {
  const repository = new FollowRepository();
  const alice = new mongoose.Types.ObjectId();
  const bob = new mongoose.Types.ObjectId();
  const carol = new mongoose.Types.ObjectId();

  it('rejects a duplicate (follower, following) pair', async () => {
    await repository.create(alice, bob);
    await expect(repository.create(alice, bob)).rejects.toMatchObject({ code: 11000 });
  });

  it('allows the same follower to follow different users, and different followers to follow the same user', async () => {
    await repository.create(alice, bob);
    await expect(repository.create(alice, carol)).resolves.toBeDefined();
    await expect(repository.create(carol, bob)).resolves.toBeDefined();
  });

  it('exists() is directional — A following B does not mean B follows A', async () => {
    await repository.create(alice, bob);
    await expect(repository.exists(alice, bob)).resolves.toBe(true);
    await expect(repository.exists(bob, alice)).resolves.toBe(false);
  });

  it('exists() returns false for a non-existent edge and handles missing ids safely', async () => {
    await expect(repository.exists(alice, carol)).resolves.toBe(false);
    await expect(repository.exists(null, bob)).resolves.toBe(false);
  });

  it('deleteOne removes the edge and returns the deleted doc; is a no-op returning null when the edge does not exist', async () => {
    await repository.create(alice, bob);
    const deleted = await repository.deleteOne(alice, bob);
    expect(deleted).not.toBeNull();
    await expect(repository.exists(alice, bob)).resolves.toBe(false);

    const secondDelete = await repository.deleteOne(alice, bob);
    expect(secondDelete).toBeNull();
  });

  it('findFollowingAmong returns only the ids the follower actually follows, as a Set', async () => {
    await repository.create(alice, bob);
    await repository.create(alice, carol);
    const result = await repository.findFollowingAmong(alice, [bob, carol, new mongoose.Types.ObjectId()]);
    expect(result.has(bob.toString())).toBe(true);
    expect(result.has(carol.toString())).toBe(true);
    expect(result.size).toBe(2);
  });
});
