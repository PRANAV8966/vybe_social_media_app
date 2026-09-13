const http = require('http');
const { Server } = require('socket.io');
const { registerChatSocketHandlers } = require('../../src/modules/chat/socket/registerChatSocketHandlers');
const { buildTestApp } = require('./buildTestApp');

/**
 * Like buildTestApp, but with a real listening HTTP server + a real
 * Socket.IO server wired up on top — needed for realtime tests, since
 * supertest never opens a real socket (it drives Express handlers directly).
 * Always close() this in an afterEach/afterAll — an unclosed listener leaks
 * a port and can hang Jest's process exit.
 */
async function buildTestServer(options) {
  const { app, container, fakeS3 } = buildTestApp(options);

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });
  container.resolve('chatGateway').attachIo(io);
  registerChatSocketHandlers(io, container);

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;

  const close = () =>
    new Promise((resolve) => {
      io.close(() => resolve());
    });

  return { app, container, fakeS3, httpServer, io, port, close };
}

module.exports = { buildTestServer };
