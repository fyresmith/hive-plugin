import { SocketClient } from '../socket';

type FilePathPayload = { relPath: string };
type RenamePayload = { oldPath: string; newPath: string };
type PresencePayload = { relPath: string; user: any };
type UserPayload = { user: any };

export interface HiveSocketEventHandlers {
  onConnect: () => void | Promise<void>;
  onDisconnect: () => void;
  onConnectError: (err: Error) => void;
  onFileUpdated: (payload: FilePathPayload) => void;
  onFileCreated: (payload: FilePathPayload) => void;
  onFileDeleted: (payload: FilePathPayload) => void;
  onFileRenamed: (payload: RenamePayload) => void;
  onExternalUpdate: (payload: FilePathPayload) => void;
  onUserJoined: (payload: UserPayload) => void;
  onUserLeft: (payload: UserPayload) => void;
  onPresenceFileOpened: (payload: PresencePayload) => void;
  onPresenceFileClosed: (payload: PresencePayload) => void;
}

export function bindHiveSocketEvents(
  socket: SocketClient,
  handlers: HiveSocketEventHandlers,
): void {
  socket.on('connect', () => {
    void handlers.onConnect();
  });

  socket.on('disconnect', handlers.onDisconnect);
  socket.on('connect_error', handlers.onConnectError);
  socket.on('file-updated', handlers.onFileUpdated);
  socket.on('file-created', handlers.onFileCreated);
  socket.on('file-deleted', handlers.onFileDeleted);
  socket.on('file-renamed', handlers.onFileRenamed);
  socket.on('external-update', handlers.onExternalUpdate);
  socket.on('user-joined', handlers.onUserJoined);
  socket.on('user-left', handlers.onUserLeft);
  socket.on('presence-file-opened', handlers.onPresenceFileOpened);
  socket.on('presence-file-closed', handlers.onPresenceFileClosed);
}
