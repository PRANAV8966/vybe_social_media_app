const mongoose = require('mongoose');
require('../../src/modules/users/models/user.model'); // registers User so populate() works
const { ConversationRepository } = require('../../src/modules/chat/repositories/conversation.repository');
const { buildCanonicalKey } = require('../../src/modules/chat/utils/canonicalKey');
const { encodeConversationCursor } = require('../../src/modules/chat/utils/conversationCursor');

describe('ConversationRepository', () => {
  const repository = new ConversationRepository();
  const alice = new mongoose.Types.ObjectId();
  const bob = new mongoose.Types.ObjectId();
  const carol = new mongoose.Types.ObjectId();

  function newConversationData(a, b) {
    return {
      participants: [a, b],
      canonicalKey: buildCanonicalKey(a, b),
      participantState: [
        { user: a, lastReadAt: null, lastDeliveredAt: null },
        { user: b, lastReadAt: null, lastDeliveredAt: null },
      ],
    };
  }

  it('enforces a unique canonicalKey — a second doc for the same pair is rejected', async () => {
    await repository.create(newConversationData(alice, bob));
    await expect(repository.create(newConversationData(alice, bob))).rejects.toMatchObject({ code: 11000 });
  });

  it('canonicalKey is order-independent, so both call orders collide', async () => {
    expect(buildCanonicalKey(alice, bob)).toBe(buildCanonicalKey(bob, alice));
  });

  it('findByIdForParticipant returns null for a non-participant (ambiguous not-found, not a 403)', async () => {
    const convo = await repository.create(newConversationData(alice, bob));
    await expect(repository.findByIdForParticipant(convo._id, carol)).resolves.toBeNull();
    await expect(repository.findByIdForParticipant(convo._id, alice)).resolves.not.toBeNull();
  });

  it('advanceReadWatermark is guarded/monotonic — never rewinds an already-advanced watermark', async () => {
    const convo = await repository.create(newConversationData(alice, bob));
    const later = new Date('2026-01-05T00:00:00Z');
    const earlier = new Date('2026-01-01T00:00:00Z');

    await repository.advanceReadWatermark(convo._id, alice, later);
    await repository.advanceReadWatermark(convo._id, alice, earlier); // out-of-order retry — must not rewind

    const reloaded = await repository.findByIdForParticipant(convo._id, alice);
    const state = reloaded.participantState.find((s) => String(s.user) === String(alice));
    expect(state.lastReadAt.toISOString()).toBe(later.toISOString());
    // Reading implies delivered — both watermarks move together.
    expect(state.lastDeliveredAt.toISOString()).toBe(later.toISOString());
  });

  it('advanceDeliveredWatermark only ever advances forward', async () => {
    const convo = await repository.create(newConversationData(alice, bob));
    const t1 = new Date('2026-01-01T00:00:00Z');
    const t2 = new Date('2026-01-02T00:00:00Z');

    await repository.advanceDeliveredWatermark(convo._id, bob, t2);
    await repository.advanceDeliveredWatermark(convo._id, bob, t1);

    const reloaded = await repository.findByIdForParticipant(convo._id, bob);
    const state = reloaded.participantState.find((s) => String(s.user) === String(bob));
    expect(state.lastDeliveredAt.toISOString()).toBe(t2.toISOString());
  });

  it('findLastMessageNotFromUser only returns conversations where someone else sent last, and only ones with a message at all', async () => {
    const withMessageFromBob = await repository.create(newConversationData(alice, bob));
    await repository.updatePreview(withMessageFromBob._id, { text: 'hi', at: new Date(), by: bob });

    const withMessageFromAlice = await repository.create(newConversationData(alice, carol));
    await repository.updatePreview(withMessageFromAlice._id, { text: 'hi', at: new Date(), by: alice });

    await repository.create(newConversationData(carol, bob)); // no messages yet, alice not a participant anyway

    const pending = await repository.findLastMessageNotFromUser(alice);
    const ids = pending.map((c) => c._id.toString());
    expect(ids).toContain(withMessageFromBob._id.toString());
    expect(ids).not.toContain(withMessageFromAlice._id.toString());
  });

  it('bulkAdvanceDelivered updates every listed conversation for the given user and no-ops on an empty list', async () => {
    const c1 = await repository.create(newConversationData(alice, bob));
    const c2 = await repository.create(newConversationData(alice, carol));
    const now = new Date();

    await expect(repository.bulkAdvanceDelivered([], alice, now)).resolves.toMatchObject({ modifiedCount: 0 });

    await repository.bulkAdvanceDelivered([c1._id, c2._id], alice, now);
    const reloaded1 = await repository.findByIdForParticipant(c1._id, alice);
    const reloaded2 = await repository.findByIdForParticipant(c2._id, alice);
    expect(reloaded1.participantState.find((s) => String(s.user) === String(alice)).lastDeliveredAt).not.toBeNull();
    expect(reloaded2.participantState.find((s) => String(s.user) === String(alice)).lastDeliveredAt).not.toBeNull();
  });

  it('listByUser paginates newest-activity-first and honors the encoded cursor', async () => {
    const c1 = await repository.create(newConversationData(alice, bob));
    await repository.updatePreview(c1._id, { text: 'first', at: new Date('2026-01-01T00:00:00Z'), by: alice });
    const c2 = await repository.create(newConversationData(alice, carol));
    await repository.updatePreview(c2._id, { text: 'second', at: new Date('2026-01-02T00:00:00Z'), by: alice });

    const firstPage = await repository.listByUser(alice, { cursor: null, limit: 1 });
    expect(firstPage.length).toBe(2); // limit+1, caller trims
    expect(firstPage[0]._id.toString()).toBe(c2._id.toString()); // most recent activity first

    const cursor = encodeConversationCursor(firstPage[0]);
    const secondPage = await repository.listByUser(alice, { cursor, limit: 1 });
    expect(secondPage[0]._id.toString()).toBe(c1._id.toString());
  });
});
