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
  onCollabPresenceHeartbeat: (payload: any) => void;
  onCollabPresenceStale: (payload: any) => void;
  onCollabThreadCreated: (payload: any) => void;
  onCollabThreadUpdated: (payload: any) => void;
  onCollabThreadDeleted: (payload: any) => void;
  onCollabCommentCreated: (payload: any) => void;
  onCollabCommentUpdated: (payload: any) => void;
  onCollabCommentDeleted: (payload: any) => void;
  onCollabTaskUpdated: (payload: any) => void;
  onCollabActivityEvent: (payload: any) => void;
  onCollabNotifyEvent: (payload: any) => void;
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
  socket.on('collab:presence:heartbeat', handlers.onCollabPresenceHeartbeat);
  socket.on('collab:presence:stale', handlers.onCollabPresenceStale);
  socket.on('collab:thread:created', handlers.onCollabThreadCreated);
  socket.on('collab:thread:updated', handlers.onCollabThreadUpdated);
  socket.on('collab:thread:deleted', handlers.onCollabThreadDeleted);
  socket.on('collab:comment:created', handlers.onCollabCommentCreated);
  socket.on('collab:comment:updated', handlers.onCollabCommentUpdated);
  socket.on('collab:comment:deleted', handlers.onCollabCommentDeleted);
  socket.on('collab:task:updated', handlers.onCollabTaskUpdated);
  socket.on('collab:activity:event', handlers.onCollabActivityEvent);
  socket.on('collab:notify:event', handlers.onCollabNotifyEvent);
}
