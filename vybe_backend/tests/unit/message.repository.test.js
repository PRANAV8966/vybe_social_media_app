const mongoose = require('mongoose');
const { MessageRepository } = require('../../src/modules/chat/repositories/message.repository');

describe('MessageRepository (idempotency + pagination)', () => {
  const repository = new MessageRepository();
  const conversationId = new mongoose.Types.ObjectId();
  const otherConversationId = new mongoose.Types.ObjectId();
  const sender = new mongoose.Types.ObjectId();
  const otherSender = new mongoose.Types.ObjectId();

  it('allows unlimited messages with no clientMessageId', async () => {
    await repository.create({ conversation: conversationId, sender, content: 'one' });
    await repository.create({ conversation: conversationId, sender, content: 'two' });
  });

  it('rejects a second insert with the same (conversation, sender, clientMessageId)', async () => {
    await repository.create({ conversation: conversationId, sender, content: 'first', clientMessageId: 'dup' });
    await expect(
      repository.create({ conversation: conversationId, sender, content: 'second', clientMessageId: 'dup' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('allows the same clientMessageId in a different conversation, or from a different sender in the same conversation', async () => {
    await repository.create({ conversation: conversationId, sender, content: 'mine', clientMessageId: 'shared' });
    await expect(
      repository.create({ conversation: otherConversationId, sender, content: 'elsewhere', clientMessageId: 'shared' }),
    ).resolves.toBeDefined();
    await expect(
      repository.create({ conversation: conversationId, sender: otherSender, content: 'theirs', clientMessageId: 'shared' }),
    ).resolves.toBeDefined();
  });

  it('findBySenderAndClientMessageId finds the exact replay and nothing else', async () => {
    const created = await repository.create({ conversation: conversationId, sender, content: 'hi', clientMessageId: 'abc' });
    const found = await repository.findBySenderAndClientMessageId(conversationId, sender, 'abc');
    expect(found._id.toString()).toBe(created._id.toString());
    await expect(repository.findBySenderAndClientMessageId(conversationId, sender, 'nope')).resolves.toBeNull();
  });

  it('listByConversation paginates newest-first on _id and scopes strictly to the given conversation', async () => {
    const m1 = await repository.create({ conversation: conversationId, sender, content: 'first' });
    const m2 = await repository.create({ conversation: conversationId, sender, content: 'second' });
    await repository.create({ conversation: otherConversationId, sender, content: 'unrelated' });

    const page = await repository.listByConversation(conversationId, { cursor: null, limit: 1 });
    expect(page.length).toBe(2); // limit+1
    expect(page[0]._id.toString()).toBe(m2._id.toString());

    const next = await repository.listByConversation(conversationId, { cursor: page[0]._id, limit: 1 });
    expect(next[0]._id.toString()).toBe(m1._id.toString());
  });

  it('findByIdInConversation returns null if the message belongs to a different conversation', async () => {
    const message = await repository.create({ conversation: conversationId, sender, content: 'scoped' });
    await expect(repository.findByIdInConversation(message._id, otherConversationId)).resolves.toBeNull();
    await expect(repository.findByIdInConversation(message._id, conversationId)).resolves.not.toBeNull();
  });
});
