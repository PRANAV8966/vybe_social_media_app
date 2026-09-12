const mongoose = require('mongoose');
require('../../src/modules/users/models/user.model'); // registers the User schema so Post.populate('author') works
const { PostRepository } = require('../../src/modules/posts/repositories/post.repository');

describe('PostRepository (idempotency index behavior)', () => {
  const repository = new PostRepository();
  const authorId = new mongoose.Types.ObjectId();
  const otherAuthorId = new mongoose.Types.ObjectId();

  it('allows unlimited posts from the same author when clientRequestId is omitted', async () => {
    await repository.create({ author: authorId, text: 'one' });
    await repository.create({ author: authorId, text: 'two' });
    await repository.create({ author: authorId, text: 'three' });
    // No throw = the partial index correctly excludes documents without clientRequestId.
  });

  it('rejects a second insert with the same (author, clientRequestId) pair', async () => {
    await repository.create({ author: authorId, text: 'first', clientRequestId: 'dup-key' });

    await expect(repository.create({ author: authorId, text: 'second', clientRequestId: 'dup-key' })).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('allows the same clientRequestId for two different authors', async () => {
    await repository.create({ author: authorId, text: 'mine', clientRequestId: 'shared-key' });
    await expect(
      repository.create({ author: otherAuthorId, text: 'theirs', clientRequestId: 'shared-key' }),
    ).resolves.toBeDefined();
  });

  it('updateOwned returns null (not an error) when the post exists but belongs to someone else', async () => {
    const post = await repository.create({ author: authorId, text: 'owned by author' });
    const result = await repository.updateOwned(post._id, otherAuthorId, { text: 'hijacked' });
    expect(result).toBeNull();
  });

  it('updateOwned succeeds for the real owner and sets editedAt', async () => {
    const post = await repository.create({ author: authorId, text: 'owned by author' });
    const result = await repository.updateOwned(post._id, authorId, { text: 'updated' });
    expect(result.text).toBe('updated');
    expect(result.editedAt).not.toBeNull();
  });

  it('softDeleteOwned is a no-op (returns null) for a non-owner and does not delete the post', async () => {
    const post = await repository.create({ author: authorId, text: 'protected' });
    const result = await repository.softDeleteOwned(post._id, otherAuthorId);
    expect(result).toBeNull();

    const stillVisible = await repository.findVisibleById(post._id);
    expect(stillVisible).not.toBeNull();
  });
});
