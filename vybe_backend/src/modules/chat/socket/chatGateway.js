const logger = require('../../../config/logger');
const { conversationRoom, userRoom } = require('./rooms');

/**
 * Thin transport adapter over Socket.IO — the only object in the chat module
 * that touches `io` directly. Services depend on this, never on `io` itself,
 * so the realtime transport can change (e.g. adding a Redis/Redis-Streams
 * adapter for multi-instance deployments) without touching business logic.
 *
 * Constructed empty and wired up via attachIo() once the Socket.IO server
 * exists (see server.js) — this breaks what would otherwise be a circular
 * dependency: the DI container builds the Express app (which resolves this
 * gateway through chatController -> chatService) before the HTTP server (and
 * therefore Socket.IO) exists yet. Every method below is a no-op until
 * attachIo() runs, which happens during startup, before any real request or
 * socket connection can reach them.
 */
class ChatGateway {
  constructor() {
    this.io = null;
  }

  attachIo(io) {
    this.io = io;
  }

  /**
   * Cluster-aware by construction: fetchSockets() is answered by whichever
   * adapter is installed — the default in-memory one today, or a distributed
   * one later — so this method's behavior (and every caller's) never needs
   * to change when the adapter does.
   */
  async isOnline(userId) {
    if (!this.io) return false;
    try {
      const sockets = await this.io.in(userRoom(userId)).fetchSockets();
      return sockets.length > 0;
    } catch (err) {
      logger.warn({ err }, 'chat presence check failed');
      return false;
    }
  }

  emitToConversation(conversationId, event, payload) {
    if (!this.io) return;
    this.io.to(conversationRoom(conversationId)).emit(event, payload);
  }

  emitToUser(userId, event, payload) {
    if (!this.io) return;
    this.io.to(userRoom(userId)).emit(event, payload);
  }
}

module.exports = { ChatGateway };
