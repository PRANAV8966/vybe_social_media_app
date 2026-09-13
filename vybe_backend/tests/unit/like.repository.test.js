const mongoose = require('mongoose');
require('../../src/modules/users/models/user.model'); // registers User so ref population/consistency stays intact
const { LikeRepository } = require('../../src/modules/posts/repositories/like.repository');

describe('LikeRepository', () => {
  const repository = new LikeRepository();
  const alice = new mongoose.Types.ObjectId();
  const bob = new mongoose.Types.ObjectId();
  const post1 = new mongoose.Types.ObjectId();
  const post2 = new mongoose.Types.ObjectId();

  it('rejects a duplicate (user, post) pair', async () => {
    await repository.create(alice, post1);
    await expect(repository.create(alice, post1)).rejects.toMatchObject({ code: 11000 });
  });

  it('allows the same user to like different posts, and different users to like the same post', async () => {
    await repository.create(alice, post1);
    await expect(repository.create(alice, post2)).resolves.toBeDefined();
    await expect(repository.create(bob, post1)).resolves.toBeDefined();
  });

  it('exists() is per-(user, post) and handles missing ids safely', async () => {
    await repository.create(alice, post1);
    await expect(repository.exists(alice, post1)).resolves.toBe(true);
    await expect(repository.exists(bob, post1)).resolves.toBe(false);
    await expect(repository.exists(alice, post2)).resolves.toBe(false);
    await expect(repository.exists(null, post1)).resolves.toBe(false);
  });

  it('deleteOne removes the like and returns the deleted doc; is a no-op returning null otherwise', async () => {
    await repository.create(alice, post1);
    const deleted = await repository.deleteOne(alice, post1);
    expect(deleted).not.toBeNull();
    await expect(repository.exists(alice, post1)).resolves.toBe(false);

    const secondDelete = await repository.deleteOne(alice, post1);
    expect(secondDelete).toBeNull();
  });

  it('findLikedAmong returns only the posts the user actually liked, as a Set, and handles an empty id list', async () => {
    await repository.create(alice, post1);
    const other = new mongoose.Types.ObjectId();
    const result = await repository.findLikedAmong(alice, [post1, post2, other]);
    expect(result.has(post1.toString())).toBe(true);
    expect(result.has(post2.toString())).toBe(false);
    expect(result.size).toBe(1);

    await expect(repository.findLikedAmong(alice, [])).resolves.toEqual(new Set());
  });
});
