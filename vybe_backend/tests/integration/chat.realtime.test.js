const request = require('supertest');
const { io: ioClient } = require('socket.io-client');
const { buildTestServer } = require('../helpers/buildTestServer');

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

function connectSocket(port, token) {
  const socket = ioClient(`http://localhost:${port}`, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  return socket;
}

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
}

function waitForEvent(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit(event, payload, (err, ack) => {
      if (err) return reject(err);
      resolve(ack);
    });
  });
}

describe('Chat realtime (Socket.IO)', () => {
  let server;
  const openSockets = [];

  afterEach(() => {
    openSockets.forEach((s) => s.disconnect());
    openSockets.length = 0;
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  async function setup() {
    server = await buildTestServer();
    const { app, port } = server;

    const { accessToken: aliceToken, user: alice } = await registerUser(app);
    const { accessToken: bobToken, user: bob } = await registerUser(app, { username: 'bob', email: 'bob@example.com' });
    await follow(app, aliceToken, 'bob');
    await follow(app, bobToken, 'ada');
    const convoRes = await startConversation(app, aliceToken, 'bob');

    return { app, port, aliceToken, bobToken, alice, bob, conversationId: convoRes.body.data.id };
  }

  it('rejects a handshake with no access token', async () => {
    const s = await setup();
    const socket = ioClient(`http://localhost:${s.port}`, {
      auth: {},
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    openSockets.push(socket);

    const err = await waitForConnect(socket).then(
      () => Promise.reject(new Error('expected connect_error')),
      (e) => e,
    );
    expect(err.data).toMatchObject({ code: 'MISSING_ACCESS_TOKEN' });
  });

  it('rejects a handshake with an invalid access token', async () => {
    const s = await setup();
    const socket = connectSocket(s.port, 'not-a-real-token');
    openSockets.push(socket);

    const err = await waitForConnect(socket).then(
      () => Promise.reject(new Error('expected connect_error')),
      (e) => e,
    );
    expect(err.data).toMatchObject({ code: 'INVALID_ACCESS_TOKEN' });
  });

  it('lets an authenticated participant join their own conversation room', async () => {
    const s = await setup();
    const aliceSocket = connectSocket(s.port, s.aliceToken);
    openSockets.push(aliceSocket);
    await waitForConnect(aliceSocket);

    const ack = await emitWithAck(aliceSocket, 'conversation:join', { conversationId: s.conversationId });
    expect(ack.success).toBe(true);
  });

  it('refuses to join a conversation the socket is not a participant of', async () => {
    const s = await setup();
    const { accessToken: strangerToken } = await registerUser(s.app, { username: 'stranger', email: 'stranger@example.com' });
    const strangerSocket = connectSocket(s.port, strangerToken);
    openSockets.push(strangerSocket);
    await waitForConnect(strangerSocket);

    const ack = await emitWithAck(strangerSocket, 'conversation:join', { conversationId: s.conversationId });
    expect(ack.success).toBe(false);
    expect(ack.error.code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('delivers a REST-sent message live to a socket joined to the conversation room', async () => {
    const s = await setup();
    const bobSocket = connectSocket(s.port, s.bobToken);
    openSockets.push(bobSocket);
    await waitForConnect(bobSocket);
    await emitWithAck(bobSocket, 'conversation:join', { conversationId: s.conversationId });

    const messageEventPromise = waitForEvent(bobSocket, 'message:new');
    const sendRes = await auth(request(s.app).post(`/api/v1/chat/conversations/${s.conversationId}/messages`), s.aliceToken).send({
      content: 'hello over the wire',
    });
    expect(sendRes.status).toBe(201);

    const payload = await messageEventPromise;
    expect(payload.message.content).toBe('hello over the wire');
    expect(payload.message.sender).toBe(sendRes.body.data.sender);
  });

  it('recovers connection state after a brief disconnect, replaying a message that arrived during the gap', async () => {
    const s = await setup();
    const bobSocket = connectSocket(s.port, s.bobToken);
    openSockets.push(bobSocket);
    await waitForConnect(bobSocket);
    await emitWithAck(bobSocket, 'conversation:join', { conversationId: s.conversationId });

    // Recovery needs an established checkpoint to resume from — a socket
    // that has never received a single room broadcast has nothing to
    // "recover" (Socket.IO's own server code requires both a pid AND a
    // string offset before it will even attempt restoring a session — verified
    // directly against node_modules/socket.io/dist/namespace.js). So the
    // first message primes that checkpoint before we simulate the blip.
    const firstMessagePromise = waitForEvent(bobSocket, 'message:new');
    await auth(request(s.app).post(`/api/v1/chat/conversations/${s.conversationId}/messages`), s.aliceToken).send({
      content: 'priming message, establishes a recovery offset',
    });
    await firstMessagePromise;

    // Simulate a genuine network blip, NOT a clean disconnect: calling
    // socket.disconnect() sends an intentional close, which Socket.IO
    // deliberately does NOT treat as recoverable (the client meant to leave).
    // Recovery only kicks in for an abrupt transport failure, so we kill the
    // raw WebSocket underneath Engine.IO directly, bypassing the graceful
    // close handshake — the same technique Socket.IO's own test suite uses.
    bobSocket.io.engine.transport.ws.terminate();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const sendRes = await auth(request(s.app).post(`/api/v1/chat/conversations/${s.conversationId}/messages`), s.aliceToken).send({
      content: 'sent while you were briefly gone',
    });
    expect(sendRes.status).toBe(201);

    const recoveredMessagePromise = waitForEvent(bobSocket, 'message:new');
    bobSocket.connect();
    await waitForConnect(bobSocket);

    expect(bobSocket.recovered).toBe(true);
    const replayed = await recoveredMessagePromise;
    expect(replayed.message.content).toBe('sent while you were briefly gone');
  });

  it('marks a message delivered the instant it is sent, if the recipient already has an active connection', async () => {
    const s = await setup();
    const aliceSocket = connectSocket(s.port, s.aliceToken);
    const bobSocket = connectSocket(s.port, s.bobToken);
    openSockets.push(aliceSocket, bobSocket);
    await Promise.all([waitForConnect(aliceSocket), waitForConnect(bobSocket)]);
    // Alice joins the conversation room to observe her own message's tick update;
    // Bob deliberately does NOT join it — only being connected (online) should
    // be enough to trigger the delivery watermark, per the presence-driven design.
    await emitWithAck(aliceSocket, 'conversation:join', { conversationId: s.conversationId });

    const statusPromise = waitForEvent(aliceSocket, 'message:status');
    const sendRes = await auth(request(s.app).post(`/api/v1/chat/conversations/${s.conversationId}/messages`), s.aliceToken).send({
      content: 'are you there',
    });
    expect(sendRes.body.data.status).toBe('delivered');

    const statusPayload = await statusPromise;
    expect(statusPayload.userId).toBe(s.bob.id); // Bob is the recipient whose delivery watermark advanced
    expect(statusPayload.lastDeliveredAt).toBeTruthy();
  });

  it('catches up delivery on reconnect for messages sent while the recipient was offline', async () => {
    const s = await setup();

    // Bob is offline for this send — message stays "sent" only.
    const sendRes = await auth(request(s.app).post(`/api/v1/chat/conversations/${s.conversationId}/messages`), s.aliceToken).send({
      content: 'while you were out',
    });
    expect(sendRes.body.data.status).toBe('sent');

    const aliceSocket = connectSocket(s.port, s.aliceToken);
    openSockets.push(aliceSocket);
    await waitForConnect(aliceSocket);
    await emitWithAck(aliceSocket, 'conversation:join', { conversationId: s.conversationId });

    const statusPromise = waitForEvent(aliceSocket, 'message:status');
    const bobSocket = connectSocket(s.port, s.bobToken);
    openSockets.push(bobSocket);
    await waitForConnect(bobSocket); // triggers markUserOnline's reconnect catch-up

    const statusPayload = await statusPromise;
    expect(statusPayload.lastDeliveredAt).toBeTruthy();

    const historyAsAlice = await auth(request(s.app).get(`/api/v1/chat/conversations/${s.conversationId}/messages`), s.aliceToken);
    expect(historyAsAlice.body.data.messages[0].status).toBe('delivered');
  });

  it('survives a literal null payload on conversation:leave/typing:start/typing:stop instead of crashing the connection', async () => {
    const s = await setup();
    const aliceSocket = connectSocket(s.port, s.aliceToken);
    openSockets.push(aliceSocket);
    await waitForConnect(aliceSocket);

    aliceSocket.emit('conversation:leave', null);
    aliceSocket.emit('typing:start', null);
    aliceSocket.emit('typing:stop', null);

    // The connection must still be alive and usable afterwards — a thrown
    // exception inside a plain socket.on() listener is not caught the way an
    // Express handler's would be, so a bad payload here previously risked
    // taking the handler (or worse) down instead of being safely ignored.
    const ack = await emitWithAck(aliceSocket, 'conversation:join', { conversationId: s.conversationId });
    expect(ack.success).toBe(true);
  });

  it('relays a typing indicator only to other participants in the same conversation room', async () => {
    const s = await setup();
    const aliceSocket = connectSocket(s.port, s.aliceToken);
    const bobSocket = connectSocket(s.port, s.bobToken);
    openSockets.push(aliceSocket, bobSocket);
    await Promise.all([waitForConnect(aliceSocket), waitForConnect(bobSocket)]);
    await Promise.all([
      emitWithAck(aliceSocket, 'conversation:join', { conversationId: s.conversationId }),
      emitWithAck(bobSocket, 'conversation:join', { conversationId: s.conversationId }),
    ]);

    const typingPromise = waitForEvent(bobSocket, 'typing');
    aliceSocket.emit('typing:start', { conversationId: s.conversationId });

    const payload = await typingPromise;
    expect(payload.isTyping).toBe(true);
    expect(payload.conversationId).toBe(s.conversationId);
  });
});
