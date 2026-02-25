import { MarkdownView, Notice, Plugin } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS, ConnectionStatus } from './types';
import { SocketClient, SocketRequestError } from './socket';
import { SyncEngine, isAllowed } from './syncEngine';
import { WriteInterceptor } from './writeInterceptor';
import { PresenceManager } from './presenceManager';
import { OfflineGuard } from './offlineGuard';
import { HiveSettingTab } from './settings';
import { getUserColor, normalizeCursorColor } from './cursorColor';
import { decodeDiscordUserFromToken } from './main/jwt';
import { bindHiveSocketEvents } from './main/socketEvents';
import { CollabWorkspaceManager } from './main/collabWorkspaceManager';
import { CollabAdapterRuntime } from './main/collabAdapterRuntime';
import {
  TimeMachineModal,
  FileHistoryVersionMeta,
  FileHistoryVersionRecord,
} from './timeMachineModal';
import { CollabAdapter } from './collab/adapters/types';
import { CollabClient, CollabThread, PresenceLocation } from './collab/collabClient';
import { FollowModeController } from './collab/followModeController';
import { ActivityFeedStore } from './collab/activityFeedStore';
import { ActiveEditorsView, HIVE_ACTIVE_EDITORS_VIEW } from './views/activeEditorsView';
import { ActivityFeedView, HIVE_ACTIVITY_FEED_VIEW } from './views/activityFeedView';
import { CollabThreadsView, HIVE_THREADS_VIEW } from './views/collabThreadsView';

export default class HivePlugin extends Plugin {
  settings: PluginSettings;

  private settingsTab: HiveSettingTab | null = null;
  private socket: SocketClient | null = null;
  private collabClient: CollabClient | null = null;
  private syncEngine: SyncEngine | null = null;
  private writeInterceptor: WriteInterceptor | null = null;
  private presenceManager: PresenceManager | null = null;
  private offlineGuard: OfflineGuard | null = null;
  private collabWorkspace: CollabWorkspaceManager | null = null;
  private collabRuntime = new CollabAdapterRuntime();
  private followController: FollowModeController;
  private activityFeedStore = new ActivityFeedStore();

  private presenceUnsubscribe: (() => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private statusBarItem: HTMLElement;
  private status: ConnectionStatus = 'disconnected';
  private isConnecting = false;
  private suppressNextDisconnect = false;

  constructor() {
    super();

    this.followController = new FollowModeController({
      onStateChange: (state) => {
        if (state.state === 'off') return;
        if (state.state === 'suspended_target_missing') {
          new Notice('Hive: Follow target unavailable. Waiting for collaborator presence.');
        }
      },
      onJumpToLocation: (location) => {
        void this.jumpToLocation(location);
      },
    });
  }

  private async disablePluginFromUi(): Promise<void> {
    const plugins = (this.app as any).plugins;
    if (plugins?.disablePlugin && typeof this.manifest.id === 'string') {
      await plugins.disablePlugin(this.manifest.id);
      return;
    }

    this.teardownConnection(true, true);
    this.offlineGuard?.unlock();
    new Notice('Hive: Please disable the plugin from Obsidian settings.');
  }

  async onload(): Promise<void> {
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    if ((this.settings as any).enabled !== undefined) {
      delete (this.settings as any).enabled;
      await this.saveSettings();
    }

    this.settingsTab = new HiveSettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    this.statusBarItem = this.addStatusBarItem();
    this.setStatus('disconnected');

    this.collabWorkspace = new CollabWorkspaceManager({
      app: this.app,
      runtime: this.collabRuntime,
      isSocketConnected: () => Boolean(this.socket?.connected),
      getSessionConfig: () => ({
        serverUrl: this.settings.serverUrl,
        token: this.settings.token,
        user: this.settings.user,
        cursorColor: this.settings.cursorColor,
        useProfileForCursor: this.settings.useProfileForCursor,
      }),
      onPresenceFileOpened: (path) => this.emitPresenceFileOpened(path),
      onPresenceFileClosed: (path) => this.emitPresenceFileClosed(path),
    });

    this.offlineGuard = new OfflineGuard({
      onReconnect: () => this.reconnectFromUi(),
      onDisable: () => {
        void this.disablePluginFromUi();
      },
      onSaveUrl: async (url) => {
        this.settings.serverUrl = url;
        await this.saveSettings();
      },
      onLogout: () => this.logout(),
      getSnapshot: () => ({
        serverUrl: this.settings.serverUrl,
        user: this.settings.user,
        isAuthenticated: this.isAuthenticated(),
      }),
    });

    this.registerView(HIVE_ACTIVE_EDITORS_VIEW, (leaf) => new ActiveEditorsView(leaf, {
      getCurrentFilePath: () => this.app.workspace.getActiveFile()?.path ?? null,
      getCurrentFileEditors: (filePath) => this.presenceManager?.getActiveEditorsForPath(filePath) ?? [],
      getWorkspaceEditors: () => this.presenceManager?.getWorkspaceActiveEditors() ?? [],
      onJumpToCollaborator: (userId) => {
        void this.jumpToCollaborator(userId);
      },
      onFollowCollaborator: (userId, mode) => {
        void this.startFollowMode(userId, mode);
      },
    }));

    this.registerView(HIVE_ACTIVITY_FEED_VIEW, (leaf) => new ActivityFeedView(leaf, {
      getCurrentFilePath: () => this.app.workspace.getActiveFile()?.path ?? null,
      getGroupedActivity: (scope, filePath, types) => this.activityFeedStore.grouped({
        scope,
        filePath,
        types,
      }),
      onScopeChange: (scope, filePath) => {
        void this.subscribeActivityScope(scope, filePath);
      },
    }));

    this.registerView(HIVE_THREADS_VIEW, (leaf) => new CollabThreadsView(leaf, {
      getCurrentFilePath: () => this.app.workspace.getActiveFile()?.path ?? null,
      listThreads: async (filePath) => {
        if (!this.collabClient) return [];
        const res = await this.collabClient.listThreads(filePath);
        return res.threads ?? [];
      },
      createThread: async (filePath, body) => {
        if (!this.collabClient) return;
        await this.collabClient.createThread(filePath, null, body);
      },
      setTaskState: async (threadId, status) => {
        if (!this.collabClient) return;
        await this.collabClient.setTaskState(threadId, status);
      },
    }));

    this.registerObsidianProtocolHandler('hive-auth', async (params) => {
      const token = params.token as string;
      if (!token) return;

      try {
        const user = decodeDiscordUserFromToken(token);
        this.settings.token = token;
        this.settings.user = user;
        await this.saveSettings();

        new Notice(`Hive: Logged in as @${user.username}`);
        await this.connect();
      } catch (err) {
        console.error('[Hive] Failed to process auth token:', err);
        new Notice('Hive: Authentication failed — invalid token.');
      }
    });

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        void this.collabWorkspace?.handleActiveLeafChange(leaf);
      }),
    );

    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.collabWorkspace?.handleLayoutChange();
      }),
    );

    this.registerCommands();

    if (this.settings.token) {
      await this.connect();
    } else {
      this.setStatus('auth-required');
      this.offlineGuard.lock('signed-out');
    }
  }

  private registerCommands(): void {
    this.addCommand({
      id: 'open-time-machine',
      name: 'Open Hive Time Machine for current file',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !isAllowed(file.path)) return false;
        if (!checking) {
          void this.openTimeMachine(file.path);
        }
        return true;
      },
    });

    this.addCommand({
      id: 'show-active-collaborators',
      name: 'Show active collaborators for current file',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !isAllowed(file.path)) return false;
        if (!checking) {
          const names = this.presenceManager?.getViewerNamesForPath(file.path) ?? [];
          if (names.length === 0) {
            new Notice('Hive: No remote collaborators currently active on this file.');
          } else {
            new Notice(`Hive collaborators: ${names.join(', ')}`);
          }
        }
        return true;
      },
    });

    this.addCommand({
      id: 'open-active-editors-panel',
      name: 'Open Hive Active Editors panel',
      callback: () => {
        void this.openPanel(HIVE_ACTIVE_EDITORS_VIEW);
      },
    });

    this.addCommand({
      id: 'open-activity-feed-panel',
      name: 'Open Hive Activity Feed panel',
      callback: () => {
        void this.openPanel(HIVE_ACTIVITY_FEED_VIEW);
      },
    });

    this.addCommand({
      id: 'open-threads-panel',
      name: 'Open Hive Threads panel',
      callback: () => {
        void this.openPanel(HIVE_THREADS_VIEW);
      },
    });

    this.addCommand({
      id: 'follow-first-collaborator',
      name: 'Follow first active collaborator (cursor mode)',
      callback: () => {
        const first = this.presenceManager?.getWorkspaceActiveEditors().find((entry) => !entry.stale);
        if (!first) {
          new Notice('Hive: No active collaborator to follow.');
          return;
        }
        void this.startFollowMode(first.userId, 'cursor');
      },
    });

    this.addCommand({
      id: 'stop-follow-mode',
      name: 'Stop Hive follow mode',
      callback: () => {
        this.stopFollowMode();
      },
    });

    this.addCommand({
      id: 'create-thread-from-selection',
      name: 'Create Hive comment thread from selection',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file || !isAllowed(view.file.path)) return false;
        if (!checking) {
          void this.createThreadFromSelection(view);
        }
        return true;
      },
    });
  }

  private async openPanel(viewType: string): Promise<void> {
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: viewType, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async connect(): Promise<void> {
    if (this.socket?.connected || this.isConnecting) return;
    if (!this.settings.token) {
      this.setStatus('auth-required');
      this.offlineGuard?.lock('signed-out');
      return;
    }

    this.isConnecting = true;
    this.setStatus('connecting');
    this.offlineGuard?.lock('connecting');
    this.teardownConnection(false, true);

    this.socket = new SocketClient(this.settings.serverUrl, this.settings.token);
    this.collabClient = new CollabClient(this.socket, this.collabRuntime.getRegistry());
    this.presenceManager = new PresenceManager(this.settings);
    this.presenceUnsubscribe = this.presenceManager.subscribe(() => {
      this.refreshActiveEditorsViews();
    });

    this.syncEngine = new SyncEngine(this.socket, this.app.vault);
    this.writeInterceptor = new WriteInterceptor(
      this.socket,
      this.app.vault,
      this.syncEngine,
      () => this.collabWorkspace?.getCollabPaths() ?? new Set(),
    );

    bindHiveSocketEvents(this.socket, {
      onConnect: async () => {
        console.log('[Hive] Connected');
        this.isConnecting = false;
        this.setStatus('connected');
        this.offlineGuard?.unlock();

        try {
          await this.collabClient?.negotiateProtocol();
        } catch (err) {
          console.warn('[Hive] Protocol negotiation failed; continuing in compatibility mode:', err);
        }

        try {
          await this.syncEngine!.initialSync();
        } catch (err) {
          console.error('[Hive] Initial sync failed:', err);
          new Notice(`Hive: Sync failed — ${(err as Error).message}`);
        }

        this.writeInterceptor!.register();
        await this.collabWorkspace?.syncOpenLeavesNow();

        await this.refreshPresenceSnapshot();
        await this.syncNotificationPreference('global', this.settings.notificationModeGlobal, null);
        await this.subscribeActivityScope('workspace', null);
        await this.loadInitialActivity();
        this.followController.onReconnect();
        this.startPresenceHeartbeat();
      },

      onDisconnect: () => {
        if (this.suppressNextDisconnect) {
          this.suppressNextDisconnect = false;
          return;
        }

        console.log('[Hive] Disconnected');
        this.isConnecting = false;
        this.setStatus('disconnected');
        this.offlineGuard?.lock('disconnected');
        this.followController.onDisconnect();
        this.teardownConnection(false);
      },

      onConnectError: (err) => {
        const msg = err.message ?? '';
        this.isConnecting = false;
        this.offlineGuard?.lock('disconnected');

        if (msg.includes('Invalid token') || msg.includes('No token')) {
          this.teardownConnection(false, true);
          this.setStatus('auth-required');
          this.offlineGuard?.lock('auth-required');
          new Notice('Hive: Session expired. Please connect with Discord again.');
          return;
        }

        this.setStatus('disconnected');
      },

      onFileUpdated: ({ relPath }) => {
        if (this.collabWorkspace?.hasCollabPath(relPath)) return;
        this.syncEngine!.pullFile(relPath);
      },

      onFileCreated: ({ relPath }) => {
        this.syncEngine!.pullFile(relPath);
      },

      onFileDeleted: ({ relPath }) => {
        this.collabWorkspace?.destroyCollabEditorsForPath(relPath);
        this.syncEngine!.deleteLocal(relPath);
      },

      onFileRenamed: ({ oldPath, newPath }) => {
        this.collabWorkspace?.destroyCollabEditorsForPath(oldPath);
        this.syncEngine!.deleteLocal(oldPath);
        this.syncEngine!.pullFile(newPath);
      },

      onExternalUpdate: ({ relPath }) => {
        if (this.collabWorkspace?.hasCollabPath(relPath)) return;
        this.syncEngine!.pullFile(relPath);
      },

      onUserJoined: ({ user }) => {
        this.presenceManager!.handleUserJoined(user);
      },

      onUserLeft: ({ user }) => {
        this.presenceManager!.handleUserLeft(user.id);
        if (this.followController.getState().targetUserId === user.id) {
          this.followController.onTargetMissing('target-left');
        }
      },

      onPresenceFileOpened: ({ relPath, user }) => {
        this.presenceManager!.handleFileOpened(relPath, user);
      },

      onPresenceFileClosed: ({ relPath, user }) => {
        this.presenceManager!.handleFileClosed(relPath, user.id);
      },

      onCollabPresenceHeartbeat: (payload) => {
        this.presenceManager?.handlePresenceHeartbeat(payload);
        const targetId = this.followController.getState().targetUserId;
        if (targetId && payload?.user?.id === targetId) {
          const location = payload?.location as PresenceLocation | undefined;
          if (location?.activeFile) {
            this.followController.onTargetLocation(targetId, {
              activeFile: location.activeFile,
              cursor: location.cursor ?? null,
              viewport: location.viewport ?? null,
            });
          } else {
            this.followController.onTargetMissing('target-location-missing');
          }
        }
      },

      onCollabPresenceStale: (payload) => {
        if (this.followController.getState().targetUserId === payload?.user?.id) {
          this.followController.onTargetMissing('target-stale');
        }
      },

      onCollabThreadCreated: () => {
        this.reloadThreadsViews();
      },

      onCollabThreadUpdated: () => {
        this.reloadThreadsViews();
      },

      onCollabThreadDeleted: () => {
        this.reloadThreadsViews();
      },

      onCollabCommentCreated: () => {
        this.reloadThreadsViews();
      },

      onCollabCommentUpdated: () => {
        this.reloadThreadsViews();
      },

      onCollabCommentDeleted: () => {
        this.reloadThreadsViews();
      },

      onCollabTaskUpdated: () => {
        this.reloadThreadsViews();
      },

      onCollabActivityEvent: ({ activity }) => {
        if (!activity) return;
        this.activityFeedStore.upsert(activity);
        this.refreshActivityViews();
      },

      onCollabNotifyEvent: (payload) => {
        const mode = payload?.mode ?? 'all';
        if (mode === 'mute') return;
        if (mode === 'digest') {
          return;
        }

        const kind = payload?.kind === 'task' ? 'Task' : 'Mention';
        const actor = payload?.actor?.username ? `@${payload.actor.username}` : 'A collaborator';
        const filePath = payload?.filePath ?? 'unknown file';
        new Notice(`Hive ${kind}: ${actor} in ${filePath}`);
      },
    });
  }

  private async loadInitialActivity(): Promise<void> {
    if (!this.collabClient) return;

    try {
      const filePath = this.app.workspace.getActiveFile()?.path ?? null;
      const [workspace, file] = await Promise.all([
        this.collabClient.listActivity({ scope: 'workspace', limit: 150 }),
        filePath
          ? this.collabClient.listActivity({ scope: 'file', filePath, limit: 150 })
          : Promise.resolve({ events: [], nextCursor: null }),
      ]);

      this.activityFeedStore.upsertMany(workspace.events ?? []);
      this.activityFeedStore.upsertMany(file.events ?? []);
      this.refreshActivityViews();
    } catch (err) {
      console.warn('[Hive] Failed to load initial activity:', err);
    }
  }

  private async subscribeActivityScope(scope: 'workspace' | 'file', filePath: string | null): Promise<void> {
    if (!this.collabClient) return;
    try {
      await this.collabClient.subscribeActivity(scope, filePath);
    } catch (err) {
      console.warn('[Hive] Failed to subscribe activity scope:', err);
    }
  }

  private async refreshPresenceSnapshot(): Promise<void> {
    if (!this.collabClient || !this.presenceManager) return;

    try {
      const res = await this.collabClient.listPresence();
      const users = Array.isArray((res as any).users) ? (res as any).users : [];
      this.presenceManager.hydratePresenceList(users);
    } catch (err) {
      console.warn('[Hive] Failed to load presence snapshot:', err);
    }
  }

  private getPresenceColor(): string | undefined {
    const user = this.settings.user;
    if (!user) return undefined;
    return normalizeCursorColor(this.settings.cursorColor) ?? getUserColor(user.id);
  }

  private emitPresenceFileOpened(path: string): void {
    if (!this.socket?.connected) return;
    this.socket.emit('presence-file-opened', {
      relPath: path,
      color: this.getPresenceColor(),
    });
  }

  private emitPresenceFileClosed(path: string): void {
    if (!this.socket?.connected) return;
    this.socket.emit('presence-file-closed', path);
  }

  private buildPresenceHeartbeatPayload(): PresenceLocation {
    const activeFile = this.app.workspace.getActiveFile()?.path ?? null;
    let cursor: { line: number; ch: number } | null = null;
    let viewport: { x: number; y: number; zoom?: number } | null = null;

    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (markdownView?.file?.path && markdownView.file.path === activeFile) {
      const cur = markdownView.editor.getCursor('from');
      if (cur) {
        cursor = {
          line: cur.line,
          ch: cur.ch,
        };
      }
    }

    const activeLeaf = this.app.workspace.activeLeaf;
    if (activeLeaf?.view?.getViewType?.() === 'canvas') {
      const canvasView = activeLeaf.view as any;
      const viewportState = canvasView?.canvas?.viewport ?? canvasView?.viewport;
      if (viewportState && typeof viewportState.x === 'number' && typeof viewportState.y === 'number') {
        viewport = {
          x: viewportState.x,
          y: viewportState.y,
          zoom: typeof viewportState.zoom === 'number' ? viewportState.zoom : undefined,
        };
      }
    }

    return {
      activeFile,
      cursor,
      viewport,
    };
  }

  private startPresenceHeartbeat(): void {
    this.stopPresenceHeartbeat();
    if (!this.collabClient || !this.socket?.connected) return;

    const tick = () => {
      if (!this.collabClient || !this.socket?.connected) return;
      this.collabClient.emitPresenceHeartbeat(this.buildPresenceHeartbeatPayload());
    };

    tick();
    this.heartbeatTimer = setInterval(tick, this.settings.presenceHeartbeatMs);
    this.registerInterval(this.heartbeatTimer);
  }

  restartPresenceHeartbeat(): void {
    if (!this.socket?.connected) return;
    this.startPresenceHeartbeat();
  }

  private stopPresenceHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  async syncNotificationPreference(
    scope: 'global' | 'workspace' | 'file',
    mode: 'all' | 'mute' | 'focus' | 'digest',
    key: string | null,
  ): Promise<void> {
    if (!this.collabClient || !this.socket?.connected) return;

    try {
      await this.collabClient.setNotifyPreference(scope, mode, key);
    } catch (err) {
      console.warn('[Hive] Failed setting notification preference:', err);
    }
  }

  private async startFollowMode(userId: string, mode: 'cursor' | 'viewport'): Promise<void> {
    this.followController.startFollowing(userId, mode);
    try {
      const res = await this.collabClient?.requestJumpToCollaborator(userId);
      const location = res?.location;
      if (!location?.activeFile) {
        this.followController.onTargetMissing('no-target-location');
        return;
      }
      this.followController.onTargetLocation(userId, location);
    } catch (err) {
      this.followController.onTargetMissing((err as Error).message);
      new Notice(`Hive: Unable to follow collaborator — ${(err as Error).message}`);
    }
  }

  private stopFollowMode(): void {
    this.followController.stopFollowing('manual-stop');
  }

  private async jumpToCollaborator(userId: string): Promise<void> {
    if (!this.collabClient) return;
    try {
      const res = await this.collabClient.requestJumpToCollaborator(userId);
      await this.jumpToLocation(res.location);
    } catch (err) {
      new Notice(`Hive: Unable to jump to collaborator — ${(err as Error).message}`);
    }
  }

  private async jumpToLocation(location: PresenceLocation): Promise<void> {
    const filePath = location.activeFile;
    if (!filePath) return;

    const file = this.app.vault.getFileByPath(filePath);
    if (!file) {
      new Notice(`Hive: Collaborator file not available locally (${filePath}).`);
      return;
    }

    const leaf = this.app.workspace.getMostRecentLeaf();
    await leaf.openFile(file, { active: true });

    if (location.cursor) {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view?.file?.path === filePath) {
        view.editor.setCursor(location.cursor);
        view.editor.scrollIntoView({
          from: location.cursor,
          to: location.cursor,
        }, true);
      }
    }
  }

  private async createThreadFromSelection(view: MarkdownView): Promise<void> {
    if (!this.collabClient) {
      new Notice('Hive: Connect before creating a thread.');
      return;
    }

    const file = view.file;
    if (!file) return;

    const from = view.editor.getCursor('from');
    const to = view.editor.getCursor('to');
    const quote = view.editor.getSelection();
    const body = window.prompt('Enter thread comment');
    if (!body || body.trim().length === 0) return;

    await this.collabClient.createThread(file.path, {
      type: 'markdown',
      start: { line: from.line, ch: from.ch },
      end: { line: to.line, ch: to.ch },
      quote,
    }, body.trim());

    await this.reloadThreadsViews();
  }

  private refreshActiveEditorsViews(): void {
    this.app.workspace.getLeavesOfType(HIVE_ACTIVE_EDITORS_VIEW).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof ActiveEditorsView) {
        view.refresh();
      }
    });
  }

  private refreshActivityViews(): void {
    this.app.workspace.getLeavesOfType(HIVE_ACTIVITY_FEED_VIEW).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof ActivityFeedView) {
        view.refresh();
      }
    });
  }

  private async reloadThreadsViews(): Promise<void> {
    const promises = this.app.workspace.getLeavesOfType(HIVE_THREADS_VIEW).map(async (leaf) => {
      const view = leaf.view;
      if (view instanceof CollabThreadsView) {
        await view.reload();
      }
    });
    await Promise.all(promises);
  }

  private teardownConnection(unlockGuard: boolean, suppressDisconnectEvent = false): void {
    this.stopPresenceHeartbeat();
    this.isConnecting = false;
    this.collabWorkspace?.resetSyncState();

    this.writeInterceptor?.unregister();
    this.writeInterceptor = null;

    this.collabWorkspace?.destroyAllCollabEditors();

    this.presenceUnsubscribe?.();
    this.presenceUnsubscribe = null;

    this.presenceManager?.unregister();
    this.presenceManager = null;
    this.syncEngine = null;
    this.collabClient = null;

    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      if (suppressDisconnectEvent) {
        this.suppressNextDisconnect = true;
      }
      socket.disconnect();
    }

    if (unlockGuard) {
      this.offlineGuard?.unlock();
    }
  }

  private startLoginFlow(): void {
    window.open(`${this.settings.serverUrl}/auth/login`, '_blank');
  }

  private refreshSettingsTab(): void {
    const tab = this.settingsTab as HiveSettingTab & { containerEl?: HTMLElement };
    if (tab?.containerEl?.isConnected) {
      tab.display();
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    const labels: Record<ConnectionStatus, string> = {
      connected:       '⬢ Hive',
      connecting:      '⬡ Hive',
      disconnected:    '⬡̸ Hive',
      'auth-required': '⛶ Hive',
    };
    this.statusBarItem.setText(labels[status]);
    this.refreshSettingsTab();
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  isAuthenticated(): boolean {
    return Boolean(this.settings.token && this.settings.user);
  }

  updateLocalCursorColor(): void {
    this.collabWorkspace?.updateLocalCursorPreferences(
      this.settings.cursorColor,
      this.settings.useProfileForCursor,
    );

    if (this.socket?.connected) {
      for (const path of this.collabWorkspace?.getCollabPaths() ?? []) {
        this.emitPresenceFileOpened(path);
      }
    }
  }

  registerCollabAdapter(adapter: CollabAdapter<any, any>, roomFactory?: Parameters<CollabAdapterRuntime['registerAdapter']>[1]): () => void {
    return this.collabRuntime.registerAdapter(adapter, roomFactory);
  }

  async reconnectFromUi(): Promise<void> {
    if (this.status === 'auth-required') {
      this.startLoginFlow();
      return;
    }
    if (!this.settings.token) {
      this.startLoginFlow();
      return;
    }
    await this.connect();
  }

  async logout(): Promise<void> {
    this.isConnecting = false;
    this.settings.token = null;
    this.settings.user = null;
    await this.saveSettings();

    this.teardownConnection(false, true);
    this.setStatus('auth-required');
    this.offlineGuard?.lock('signed-out');

    new Notice('Hive: Logged out.');
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async openTimeMachine(relPath: string): Promise<void> {
    if (!this.socket?.connected) {
      new Notice('Hive: Connect before opening Time Machine.');
      return;
    }

    const modal = new TimeMachineModal(this.app, {
      relPath,
      fetchHistory: (path) => this.fetchFileHistory(path),
      fetchVersion: (path, versionId) => this.fetchHistoryVersion(path, versionId),
      restoreVersion: (path, version) => this.restoreHistoryVersion(path, version),
    });
    modal.open();
  }

  private async fetchFileHistory(relPath: string): Promise<FileHistoryVersionMeta[]> {
    if (!this.socket?.connected) {
      throw new Error('Hive is disconnected');
    }
    const res = await this.socket.request<{ versions: FileHistoryVersionMeta[] }>('file-history-list', {
      relPath,
      limit: 150,
    });
    return Array.isArray(res.versions) ? res.versions : [];
  }

  private async fetchHistoryVersion(relPath: string, versionId: string): Promise<FileHistoryVersionRecord> {
    if (!this.socket?.connected) {
      throw new Error('Hive is disconnected');
    }
    const res = await this.socket.request<{ version: FileHistoryVersionRecord }>('file-history-read', {
      relPath,
      versionId,
    });
    return res.version;
  }

  private async restoreHistoryVersion(
    relPath: string,
    version: FileHistoryVersionRecord,
  ): Promise<void> {
    if (!this.socket?.connected || !this.syncEngine) {
      throw new Error('Hive is disconnected');
    }
    if (this.collabWorkspace?.hasCollabPath(relPath)) {
      throw new Error('Close active live editors for this file before restoring.');
    }

    const expectedHash = this.syncEngine.getKnownHash(relPath);
    const payload: { relPath: string; content: string; expectedHash?: string } = {
      relPath,
      content: version.content,
    };
    if (expectedHash) {
      payload.expectedHash = expectedHash;
    }

    try {
      const res = await this.socket.request<{ hash: string }>('file-write', payload);
      this.syncEngine.recordKnownState(relPath, version.content, res.hash);
      await this.syncEngine.pullFile(relPath);
    } catch (err) {
      if (err instanceof SocketRequestError && err.code === 'CONFLICT') {
        await this.syncEngine.pullFile(relPath);
        throw new Error('Restore conflict: pulled latest server version. Re-open Time Machine to retry.');
      }
      throw err;
    }
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(HIVE_ACTIVE_EDITORS_VIEW);
    this.app.workspace.detachLeavesOfType(HIVE_ACTIVITY_FEED_VIEW);
    this.app.workspace.detachLeavesOfType(HIVE_THREADS_VIEW);

    this.teardownConnection(true, true);
    this.offlineGuard?.unlock();
  }
}
