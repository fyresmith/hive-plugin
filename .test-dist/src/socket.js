"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketClient = exports.SocketRequestError = void 0;
const socket_io_client_1 = require("socket.io-client");
class SocketRequestError extends Error {
    constructor(response) {
        super(response?.error ?? 'Server error');
        this.name = 'SocketRequestError';
        this.code = typeof response?.code === 'string' ? response.code : undefined;
        this.data = response;
    }
}
exports.SocketRequestError = SocketRequestError;
class SocketClient {
    constructor(serverUrl, token) {
        this.socket = (0, socket_io_client_1.io)(serverUrl, {
            auth: { token },
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 30000,
            randomizationFactor: 0.5,
        });
    }
    on(event, handler) {
        this.socket.on(event, handler);
    }
    off(event, handler) {
        this.socket.off(event, handler);
    }
    emit(event, ...args) {
        this.socket.emit(event, ...args);
    }
    /**
     * Emit an event with an acknowledgement callback.
     * Resolves with the server's response payload or rejects after timeoutMs.
     */
    request(event, data, timeoutMs = 8000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Socket request timed out: ${event}`)), timeoutMs);
            const callback = (res) => {
                clearTimeout(timer);
                if (res?.ok === false) {
                    reject(new SocketRequestError(res));
                }
                else {
                    resolve(res);
                }
            };
            if (data !== undefined) {
                this.socket.emit(event, data, callback);
            }
            else {
                this.socket.emit(event, callback);
            }
        });
    }
    get connected() {
        return this.socket.connected;
    }
    get id() {
        return this.socket.id;
    }
    disconnect() {
        this.socket.disconnect();
    }
}
exports.SocketClient = SocketClient;
