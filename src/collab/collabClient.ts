import { SocketClient } from '../socket';
import { buildProtocolHello, ProtocolNegotiationResponse } from './protocol';
import { AdapterRegistry } from './adapters/registry';

export interface PresenceLocation {
  activeFile: string | null;
  cursor?: { line: number; ch: number } | null;
  viewport?: { x: number; y: number; zoom?: number } | null;
}

export interface ThreadAnchor {
  type: 'markdown' | 'canvas';
  start?: { line: number; ch: number };
  end?: { line: number; ch: number };
  quote?: string;
  entityId?: string;
  entityType?: string;
}

export interface CollabThread {
  threadId: string;
  filePath: string;
  anchor: ThreadAnchor | null;
  status: 'thread_open' | 'thread_resolved' | 'thread_archived';
  participants: string[];
  comments: CollabComment[];
  task: CollabTask | null;
  createdAt: number;
  updatedAt: number;
}

export interface CollabComment {
  commentId: string;
  threadId: string;
  author: { id?: string | null; username?: string | null };
  body: string;
  mentions: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CollabTask {
  taskId: string;
  threadId: string;
  status: 'open' | 'resolved';
  assignee: { id?: string | null; username?: string | null } | null;
  dueAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CollabActivity {
  eventId: string;
  type: 'edit' | 'create' | 'delete' | 'rename' | 'comment' | 'task' | 'restore' | 'presence' | 'external';
  filePath: string | null;
  actor: { id?: string | null; username?: string | null } | null;
  payload: Record<string, unknown> | null;
  groupKey: string | null;
  ts: number;
}

export class CollabClient {
  constructor(
    private socket: SocketClient,
    private registry: AdapterRegistry,
  ) {}

  async negotiateProtocol(): Promise<ProtocolNegotiationResponse> {
    return this.socket.request<ProtocolNegotiationResponse>('collab:hello', buildProtocolHello(this.registry.listDescriptors()));
  }

  emitPresenceHeartbeat(location: PresenceLocation): void {
    this.socket.emit('collab:presence:heartbeat', location);
  }

  async requestJumpToCollaborator(userId: string): Promise<{ user: any; location: PresenceLocation }> {
    return this.socket.request('collab:presence:jump', { userId });
  }

  async listPresence(): Promise<{ users: any[] }> {
    return this.socket.request('collab:presence:list');
  }

  async listThreads(filePath: string | null = null): Promise<{ threads: CollabThread[] }> {
    return this.socket.request('collab:thread:list', { filePath });
  }

  async createThread(filePath: string, anchor: ThreadAnchor | null, body: string): Promise<{ thread: CollabThread }> {
    return this.socket.request('collab:thread:create', { filePath, anchor, body });
  }

  async updateThread(threadId: string, patch: Record<string, unknown>): Promise<{ thread: CollabThread }> {
    return this.socket.request('collab:thread:update', { threadId, patch });
  }

  async deleteThread(threadId: string): Promise<{ thread: CollabThread }> {
    return this.socket.request('collab:thread:delete', { threadId });
  }

  async createComment(threadId: string, body: string): Promise<{ thread: CollabThread; comment: CollabComment }> {
    return this.socket.request('collab:comment:create', { threadId, body });
  }

  async updateComment(threadId: string, commentId: string, body: string): Promise<{ thread: CollabThread; comment: CollabComment }> {
    return this.socket.request('collab:comment:update', { threadId, commentId, body });
  }

  async deleteComment(threadId: string, commentId: string): Promise<{ thread: CollabThread; commentId: string }> {
    return this.socket.request('collab:comment:delete', { threadId, commentId });
  }

  async setTaskState(threadId: string, status: 'open' | 'resolved', assignee: { id?: string | null; username?: string | null } | null = null): Promise<{ thread: CollabThread; task: CollabTask }> {
    return this.socket.request('collab:task:set-state', { threadId, status, assignee });
  }

  async listActivity(payload: {
    scope: 'workspace' | 'file';
    filePath?: string | null;
    types?: string[];
    limit?: number;
    cursor?: string | null;
  }): Promise<{ events: CollabActivity[]; nextCursor: string | null }> {
    return this.socket.request('collab:activity:list', payload);
  }

  async subscribeActivity(scope: 'workspace' | 'file', filePath: string | null = null): Promise<void> {
    await this.socket.request('collab:activity:subscribe', { scope, filePath });
  }

  async getNotifyPreferences(): Promise<{
    preferences: {
      global: string;
      workspace: Record<string, string>;
      file: Record<string, string>;
    };
  }> {
    return this.socket.request('collab:notify:preferences:get');
  }

  async setNotifyPreference(scope: 'global' | 'workspace' | 'file', mode: 'mute' | 'focus' | 'digest' | 'all', key: string | null = null): Promise<{
    preferences: {
      global: string;
      workspace: Record<string, string>;
      file: Record<string, string>;
    };
  }> {
    return this.socket.request('collab:notify:preferences:set', { scope, mode, key });
  }
}
