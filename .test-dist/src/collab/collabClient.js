"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollabClient = void 0;
const protocol_1 = require("./protocol");
class CollabClient {
    constructor(socket, registry) {
        this.socket = socket;
        this.registry = registry;
    }
    async negotiateProtocol() {
        return this.socket.request('collab:hello', (0, protocol_1.buildProtocolHello)(this.registry.listDescriptors()));
    }
    emitPresenceHeartbeat(location) {
        this.socket.emit('collab:presence:heartbeat', location);
    }
    async requestJumpToCollaborator(userId) {
        return this.socket.request('collab:presence:jump', { userId });
    }
    async listPresence() {
        return this.socket.request('collab:presence:list');
    }
    async listThreads(filePath = null) {
        return this.socket.request('collab:thread:list', { filePath });
    }
    async createThread(filePath, anchor, body) {
        return this.socket.request('collab:thread:create', { filePath, anchor, body });
    }
    async updateThread(threadId, patch) {
        return this.socket.request('collab:thread:update', { threadId, patch });
    }
    async deleteThread(threadId) {
        return this.socket.request('collab:thread:delete', { threadId });
    }
    async createComment(threadId, body) {
        return this.socket.request('collab:comment:create', { threadId, body });
    }
    async updateComment(threadId, commentId, body) {
        return this.socket.request('collab:comment:update', { threadId, commentId, body });
    }
    async deleteComment(threadId, commentId) {
        return this.socket.request('collab:comment:delete', { threadId, commentId });
    }
    async setTaskState(threadId, status, assignee = null) {
        return this.socket.request('collab:task:set-state', { threadId, status, assignee });
    }
    async listActivity(payload) {
        return this.socket.request('collab:activity:list', payload);
    }
    async subscribeActivity(scope, filePath = null) {
        await this.socket.request('collab:activity:subscribe', { scope, filePath });
    }
    async getNotifyPreferences() {
        return this.socket.request('collab:notify:preferences:get');
    }
    async setNotifyPreference(scope, mode, key = null) {
        return this.socket.request('collab:notify:preferences:set', { scope, mode, key });
    }
}
exports.CollabClient = CollabClient;
