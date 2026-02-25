import { io, Socket } from 'socket.io-client';

export class SocketClient {
  private socket: Socket;

  constructor(serverUrl: string, token: string, vaultId: string) {
    this.socket = io(serverUrl, {
      auth: { token, vaultId },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
    });
  }

  on(event: string, handler: (...args: any[]) => void): void {
    this.socket.on(event, handler);
  }

  off(event: string, handler: (...args: any[]) => void): void {
    this.socket.off(event, handler);
  }

  emit(event: string, ...args: any[]): void {
    this.socket.emit(event, ...args);
  }

  /**
   * Emit an event with an acknowledgement callback.
   * Resolves with the server's response payload or rejects after timeoutMs.
   */
  request<T = any>(event: string, data?: any, timeoutMs = 8000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Socket request timed out: ${event}`)),
        timeoutMs
      );

      const callback = (res: any) => {
        clearTimeout(timer);
        if (res?.ok === false) {
          reject(new Error(res.error ?? 'Server error'));
        } else {
          resolve(res as T);
        }
      };

      if (data !== undefined) {
        this.socket.emit(event, data, callback);
      } else {
        this.socket.emit(event, callback);
      }
    });
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  get id(): string | undefined {
    return this.socket.id;
  }

  disconnect(): void {
    this.socket.disconnect();
  }
}
