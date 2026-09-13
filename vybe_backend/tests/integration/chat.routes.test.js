const request = require('supertest');
const { buildTestApp } = require('../helpers/buildTestApp');

async function registerUser(app, overrides = {}) {
  const payload = {
    name: 'Ada Lovelace',
    username: 'ada',
    email: 'ada@example.com',
    password: 'correct-horse-battery-staple',
    ...overrides,
  };
  const res = await request(app).post('/api/v1/auth/register').send(payload);
  return { accessToken: res.body.data.accessToken, user: res.body.data.user };
}

function auth(req, token) {
  return req.set('Authorization', `Bearer ${token}`);
}

async function follow(app, token, targetUsername) {
  return auth(request(app).post(`/api/v1/follow/${targetUsername}`), token);
}

async function startConversation(app, token, username) {
  return auth(request(app).post('/api/v1/chat/conversations'), token).send({ username });
}

async function sendMessage(app, token, conversationId, body) {
  return auth(request(app).post(`/api/v1/chat/conversations/${conversationId}/messages`), token).send(body);
}

describe('Chat routes', () => {
  it('rejects unauthenticated requests', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/api/v1/chat/conversations').send({ username: 'anyone' });
    expect(res.status).toBe(401);
  });

  it('rejects starting a conversation with a user you do not follow', async () => {
    const { app } = buildTestApp();
    const { accessToken: aliceToken } = await registerUser(app);
    await registerUser(app, { username: 'bob', email: 'bob@example.com' });

    const res = await startConversation(app, aliceToken, 'bob');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_FOLLOWING');
  });

  it('rejects starting a conversation with yourself', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);

    const res = await startConversation(app, accessToken, 'ada');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_MESSAGE_SELF');
  });

  it('returns 404 for a non-existent target username', async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerUser(app);
    const res = await startConversation(app, accessToken, 'ghost');
    expect(res.status).toBe(404);
  });

  it('starts a conversation once you follow the target, and is idempotent on a repeat start', async () => {
    const { app } = buildTestApp();
    const { accessToken: aliceToken } = await registerUser(app);
    await registerUser(app, { username: 'bob', email: 'bob@example.com' });
    await follow(app, aliceToken, 'bob');

    const first = await startConversation(app, aliceToken, 'bob');
    expect(first.status).toBe(201);
    expect(first.body.data.peer.username).toBe('bob');

    const second = await startConversation(app, aliceToken, 'bob');
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  describe('sending and reading messages', () => {
    async function setupMutualConversation(app) {
      const { accessToken: aliceToken, user: alice } = await registerUser(app);
      const { accessToken: bobToken, user: bob } = await registerUser(app, { username: 'bob', email: 'bob@example.com' });
      await follow(app, aliceToken, 'bob');
      await follow(app, bobToken, 'ada'); // mutual, so both directions can send
      const convoRes = await startConversation(app, aliceToken, 'bob');
      return { aliceToken, bobToken, alice, bob, conversationId: convoRes.body.data.id };
    }

    it('sends a text message and it appears in history for both participants', async () => {
      const { app } = buildTestApp();
      const { aliceToken, bobToken, conversationId } = await setupMutualConversation(app);

      const sendRes = await sendMessage(app, aliceToken, conversationId, { content: 'hey bob' });
      expect(sendRes.status).toBe(201);
      expect(sendRes.body.data.content).toBe('hey bob');
      expect(sendRes.body.data.status).toBe('sent');

      const historyAsBob = await auth(request(app).get(`/api/v1/chat/conversations/${conversationId}/messages`), bobToken);
      expect(historyAsBob.status).toBe(200);
      expect(historyAsBob.body.data.messages).toHaveLength(1);
      expect(historyAsBob.body.data.messages[0].content).toBe('hey bob');
    });

    it('is idempotent when the same clientMessageId is sent twice', async () => {
      const { app } = buildTestApp();
      const { aliceToken, conversationId } = await setupMutualConversation(app);

      const first = await sendMessage(app, aliceToken, conversationId, { content: 'once', clientMessageId: 'retry-1' });
      const second = await sendMessage(app, aliceToken, conversationId, { content: 'once', clientMessageId: 'retry-1' });

      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.data.id).toBe(first.body.data.id);
    });

    it('returns 404 (not 403) when messaging a conversation you are not part of', async () => {
      const { app } = buildTestApp();
      const { conversationId } = await setupMutualConversation(app);
      const { accessToken: strangerToken } = await registerUser(app, { username: 'stranger', email: 'stranger@example.com' });

      const res = await sendMessage(app, strangerToken, conversationId, { content: 'intrusion' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CONVERSATION_NOT_FOUND');
    });

    it('blocks further sends the moment the sender unfollows the recipient, even inside an existing conversation', async () => {
      const { app } = buildTestApp();
      const { aliceToken, bobToken, conversationId } = await setupMutualConversation(app);

      await auth(request(app).delete('/api/v1/follow/bob'), aliceToken);

      const aliceSend = await sendMessage(app, aliceToken, conversationId, { content: 'can I still talk?' });
      expect(aliceSend.status).toBe(403);
      expect(aliceSend.body.error.code).toBe('NOT_FOLLOWING');

      // Bob still follows Alice, so the conversation is not fully dead — just one-directional now.
      const bobSend = await sendMessage(app, bobToken, conversationId, { content: 'yes I can' });
      expect(bobSend.status).toBe(201);
    });

    it('marks messages as read up to the given message id, and the sender sees the updated status', async () => {
      const { app } = buildTestApp();
      const { aliceToken, bobToken, conversationId } = await setupMutualConversation(app);

      await sendMessage(app, aliceToken, conversationId, { content: 'first' });
      const secondSend = await sendMessage(app, aliceToken, conversationId, { content: 'second' });
      const lastMessageId = secondSend.body.data.id;

      const readRes = await auth(request(app).post(`/api/v1/chat/conversations/${conversationId}/read`), bobToken).send({
        lastReadMessageId: lastMessageId,
      });
      expect(readRes.status).toBe(200);

      const historyAsAlice = await auth(request(app).get(`/api/v1/chat/conversations/${conversationId}/messages`), aliceToken);
      const statuses = historyAsAlice.body.data.messages.map((m) => m.status);
      expect(statuses).toEqual(['read', 'read']); // both messages are at-or-before the read watermark
    });

    it('rejects marking read with a message id that does not belong to the conversation', async () => {
      const { app } = buildTestApp();
      const { bobToken, conversationId } = await setupMutualConversation(app);

      const res = await auth(request(app).post(`/api/v1/chat/conversations/${conversationId}/read`), bobToken).send({
        lastReadMessageId: '507f1f77bcf86cd799439011',
      });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('MESSAGE_NOT_FOUND');
    });

    it('lists conversations most-recently-active first', async () => {
      const { app } = buildTestApp();
      const { accessToken: aliceToken } = await registerUser(app);
      await registerUser(app, { username: 'bob', email: 'bob@example.com' });
      await registerUser(app, { username: 'carol', email: 'carol@example.com' });
      await follow(app, aliceToken, 'bob');
      await follow(app, aliceToken, 'carol');

      const withBob = await startConversation(app, aliceToken, 'bob');
      const withCarol = await startConversation(app, aliceToken, 'carol');
      await sendMessage(app, aliceToken, withBob.body.data.id, { content: 'older activity' });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await sendMessage(app, aliceToken, withCarol.body.data.id, { content: 'newer activity' });

      const listRes = await auth(request(app).get('/api/v1/chat/conversations'), aliceToken);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.conversations[0].peer.username).toBe('carol');
      expect(listRes.body.data.conversations[1].peer.username).toBe('bob');
    });
  });
});
