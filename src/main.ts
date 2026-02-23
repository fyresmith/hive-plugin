import { Plugin, WorkspaceLeaf, MarkdownView, Notice, TFile } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS, ConnectionStatus } from './types';
import { SocketClient } from './socket';
import { SyncEngine } from './syncEngine';
import { WriteInterceptor } from './writeInterceptor';
import { CollabEditor, getUserColor, normalizeCursorColor } from './collabEditor';
import { PresenceManager } from './presenceManager';
import { OfflineGuard } from './offlineGuard';
import { HiveSettingTab } from './settings';

interface CollabBinding {
  key: string;
  path: string;
  leaf: WorkspaceLeaf;
  view: MarkdownView;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('Malformed JWT');
  }

  const base64Url = parts[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(atob(padded));
}

export default class HivePlugin extends Plugin {
  settings: PluginSettings;

  private settingsTab: HiveSettingTab | null = null;
  private socket: SocketClient | null = null;
  private syncEngine: SyncEngine | null = null;
  private writeInterceptor: WriteInterceptor | null = null;
  private presenceManager: PresenceManager | null = null;
  private offlineGuard: OfflineGuard | null = null;
  private collabBindings = new Map<string, CollabBinding>();
  private collabRooms = new Map<string, CollabEditor>();
  private leafKeys = new WeakMap<WorkspaceLeaf, string>();
  private nextLeafKey = 1;
  private statusBarItem: HTMLElement;
  private status: ConnectionStatus = 'disconnected';
  private isConnecting = false;
  private suppressNextDisconnect = false;
  private syncingOpenLeaves = false;
  private syncLeavesAgain = false;

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
    // Load settings
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    if ((this.settings as any).enabled !== undefined) {
      delete (this.settings as any).enabled;
      await this.saveSettings();
    }

    // Settings tab
    this.settingsTab = new HiveSettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    // Status bar
    this.statusBarItem = this.addStatusBarItem();
    this.setStatus('disconnected');

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

    // Obsidian URI handler for OAuth callback
    this.registerObsidianProtocolHandler('hive-auth', async (params) => {
      const token = params.token as string;
      if (!token) return;

      try {
        const payload = decodeJwtPayload(token) as {
          id?: string;
          username?: string;
          avatarUrl?: string;
        };
        if (!payload.id || !payload.username || !payload.avatarUrl) {
          throw new Error('Token missing required claims');
        }

        this.settings.token = token;
        this.settings.user = {
          id: payload.id,
          username: payload.username,
          avatarUrl: payload.avatarUrl,
        };
        await this.saveSettings();
        new Notice(`Hive: Logged in as @${payload.username}`);
        await this.connect();
      } catch (err) {
        console.error('[Hive] Failed to process auth token:', err);
        new Notice('Hive: Authentication failed — invalid token.');
      }
    });

    // Workspace event listeners
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', this.onActiveLeafChange.bind(this))
    );
    this.registerEvent(
      this.app.workspace.on('layout-change', this.onLayoutChange.bind(this))
    );

    if (this.settings.token) {
      await this.connect();
    } else {
      this.setStatus('auth-required');
      this.offlineGuard.lock('signed-out');
    }
  }

  // ---------------------------------------------------------------------------
  // Connect / disconnect
  // ---------------------------------------------------------------------------

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
    this.presenceManager = new PresenceManager(this.settings);
    this.syncEngine = new SyncEngine(this.socket, this.app.vault);
    this.writeInterceptor = new WriteInterceptor(
      this.socket,
      this.app.vault,
      this.syncEngine,
      () => this.getCollabPaths()
    );

    // ---- Socket events ----

    this.socket.on('connect', async () => {
      console.log('[Hive] Connected');
      this.isConnecting = false;
      this.setStatus('connected');
      this.offlineGuard?.unlock();

      try {
        await this.syncEngine!.initialSync();
      } catch (err) {
        console.error('[Hive] Initial sync failed:', err);
        new Notice(`Hive: Sync failed — ${(err as Error).message}`);
      }

      this.writeInterceptor!.register();

      await this.syncOpenLeavesNow();
    });

    this.socket.on('disconnect', () => {
      if (this.suppressNextDisconnect) {
        this.suppressNextDisconnect = false;
        return;
      }
      console.log('[Hive] Disconnected');
      this.isConnecting = false;
      this.setStatus('disconnected');
      this.offlineGuard?.lock('disconnected');
      this.teardownConnection(false);
    });

    this.socket.on('connect_error', (err: Error) => {
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
    });

    // ---- File events ----

    this.socket.on('file-updated', ({ relPath }: { relPath: string }) => {
      if (this.hasCollabPath(relPath)) return; // live room owns this path
      this.syncEngine!.pullFile(relPath);
    });

    this.socket.on('file-created', ({ relPath }: { relPath: string }) => {
      this.syncEngine!.pullFile(relPath);
    });

    this.socket.on('file-deleted', ({ relPath }: { relPath: string }) => {
      this.destroyCollabEditorsForPath(relPath);
      this.syncEngine!.deleteLocal(relPath);
    });

    this.socket.on('file-renamed', ({ oldPath, newPath }: { oldPath: string; newPath: string }) => {
      this.destroyCollabEditorsForPath(oldPath);
      this.syncEngine!.deleteLocal(oldPath);
      this.syncEngine!.pullFile(newPath);
    });

    this.socket.on('external-update', ({ relPath }: { relPath: string }) => {
      if (this.hasCollabPath(relPath)) return;
      this.syncEngine!.pullFile(relPath);
    });

    // ---- Presence events ----

    this.socket.on('user-joined', ({ user }: any) => {
      this.presenceManager!.handleUserJoined(user);
    });

    this.socket.on('user-left', ({ user }: any) => {
      this.presenceManager!.handleUserLeft(user.id);
    });

    this.socket.on('presence-file-opened', ({ relPath, user }: any) => {
      this.presenceManager!.handleFileOpened(relPath, user);
    });

    this.socket.on('presence-file-closed', ({ relPath, user }: any) => {
      this.presenceManager!.handleFileClosed(relPath, user.id);
    });
  }

  // ---------------------------------------------------------------------------
  // Workspace event handlers
  // ---------------------------------------------------------------------------

  private async onActiveLeafChange(leaf: WorkspaceLeaf | null): Promise<void> {
    if (!this.socket?.connected) return;
    if (!leaf) return;

    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    if (!this.isSourceMode(view)) {
      this.scheduleOpenLeavesSync();
      return;
    }
    const file = view.file;
    if (!file || !file.path.endsWith('.md')) return;

    await this.attachCollabEditor(leaf, view, file);
    this.scheduleOpenLeavesSync();
  }

  private onLayoutChange(): void {
    if (!this.socket?.connected) return;
    this.scheduleOpenLeavesSync();
  }

  // ---------------------------------------------------------------------------
  // Collab editor lifecycle
  // ---------------------------------------------------------------------------

  private getLeafKey(leaf: WorkspaceLeaf): string {
    let key = this.leafKeys.get(leaf);
    if (!key) {
      key = `leaf-${this.nextLeafKey++}`;
      this.leafKeys.set(leaf, key);
    }
    return key;
  }

  private makeBindingKey(leaf: WorkspaceLeaf, path: string): string {
    return `${this.getLeafKey(leaf)}::${path}`;
  }

  private isSourceMode(view: MarkdownView): boolean {
    const mode = (view as any).getMode?.();
    if (typeof mode !== 'string') return true;
    return mode !== 'preview';
  }

  private getOpenMarkdownLeaves(): Array<{ leaf: WorkspaceLeaf; view: MarkdownView; file: TFile }> {
    const leaves: Array<{ leaf: WorkspaceLeaf; view: MarkdownView; file: TFile }> = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) return;
      if (!this.isSourceMode(view)) return;
      const file = view.file;
      if (!file || !file.path.endsWith('.md')) return;
      leaves.push({ leaf, view, file });
    });
    return leaves;
  }

  private getCollabPaths(): Set<string> {
    return new Set(this.collabRooms.keys());
  }

  private hasCollabPath(path: string): boolean {
    return this.collabRooms.has(path);
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

  private async attachCollabEditor(leaf: WorkspaceLeaf, view: MarkdownView, file: TFile): Promise<void> {
    if (!this.settings.token || !this.settings.user) return;
    const key = this.makeBindingKey(leaf, file.path);
    if (this.collabBindings.has(key)) return;
    const hadPathBinding = this.hasCollabPath(file.path);

    let room = this.collabRooms.get(file.path);
    if (!room) {
      room = new CollabEditor(
        this.settings.serverUrl,
        file.path,
        this.settings.user,
        this.settings.token,
        this.settings.cursorColor,
        this.settings.useProfileForCursor
      );
      room.attach();
      this.collabRooms.set(file.path, room);
    }

    room.attachView(key, view);
    this.collabBindings.set(key, { key, path: file.path, leaf, view });

    if (!hadPathBinding && this.socket?.connected) {
      this.emitPresenceFileOpened(file.path);
    }
  }

  private destroyCollabEditor(key: string): void {
    const binding = this.collabBindings.get(key);
    if (binding) {
      const path = binding.path;
      const room = this.collabRooms.get(path);
      room?.detachView(key);
      this.collabBindings.delete(key);
      if (room?.isEmpty()) {
        room.destroy();
        this.collabRooms.delete(path);
      }
      if (this.socket?.connected && !this.hasCollabPath(path)) {
        this.socket.emit('presence-file-closed', path);
      }
    }
  }

  private destroyCollabEditorsForPath(path: string): void {
    const keys = [...this.collabBindings.values()]
      .filter((binding) => binding.path === path)
      .map((binding) => binding.key);

    if (keys.length === 0) {
      const room = this.collabRooms.get(path);
      if (!room) return;
      room.destroy();
      this.collabRooms.delete(path);
      if (this.socket?.connected) {
        this.socket.emit('presence-file-closed', path);
      }
      return;
    }

    for (const key of keys) {
      this.destroyCollabEditor(key);
    }

    const room = this.collabRooms.get(path);
    if (room) {
      room.destroy();
      this.collabRooms.delete(path);
    }
  }

  private destroyAllCollabEditors(): void {
    for (const [key] of this.collabBindings) {
      this.destroyCollabEditor(key);
    }
    for (const [, room] of this.collabRooms) {
      room.destroy();
    }
    this.collabBindings.clear();
    this.collabRooms.clear();
  }

  private scheduleOpenLeavesSync(): void {
    if (this.syncingOpenLeaves) {
      this.syncLeavesAgain = true;
      return;
    }

    this.syncingOpenLeaves = true;
    void this.syncOpenLeavesNow().finally(() => {
      this.syncingOpenLeaves = false;
      if (this.syncLeavesAgain) {
        this.syncLeavesAgain = false;
        this.scheduleOpenLeavesSync();
      }
    });
  }

  private async syncOpenLeavesNow(): Promise<void> {
    if (!this.socket?.connected) return;

    const openLeaves = this.getOpenMarkdownLeaves();
    const activeKeys = new Set<string>();

    for (const { leaf, view, file } of openLeaves) {
      const key = this.makeBindingKey(leaf, file.path);
      activeKeys.add(key);
      if (!this.collabBindings.has(key)) {
        await this.attachCollabEditor(leaf, view, file);
      }
    }

    const existingKeys = [...this.collabBindings.keys()];
    for (const key of existingKeys) {
      if (!activeKeys.has(key)) {
        this.destroyCollabEditor(key);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Status bar
  // ---------------------------------------------------------------------------

  private teardownConnection(unlockGuard: boolean, suppressDisconnectEvent = false): void {
    this.isConnecting = false;
    this.syncingOpenLeaves = false;
    this.syncLeavesAgain = false;
    this.writeInterceptor?.unregister();
    this.writeInterceptor = null;
    this.destroyAllCollabEditors();
    this.presenceManager?.unregister();
    this.presenceManager = null;
    this.syncEngine = null;

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
      connected: '⬤ Hive',
      connecting: '◌ Hive',
      disconnected: '○ Hive',
      'auth-required': '⚠ Hive',
    };
    this.statusBarItem.setText(labels[status]);
    this.refreshSettingsTab();
  }

  // ---------------------------------------------------------------------------
  // Public API (used by settings tab)
  // ---------------------------------------------------------------------------

  getStatus(): ConnectionStatus {
    return this.status;
  }

  isAuthenticated(): boolean {
    return Boolean(this.settings.token && this.settings.user);
  }

  updateLocalCursorColor(): void {
    for (const [, room] of this.collabRooms) {
      room.updateLocalCursorPreferences(
        this.settings.cursorColor,
        this.settings.useProfileForCursor
      );
    }

    if (this.socket?.connected) {
      for (const path of this.getCollabPaths()) {
        this.emitPresenceFileOpened(path);
      }
    }
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

  // ---------------------------------------------------------------------------
  // Unload
  // ---------------------------------------------------------------------------

  onunload(): void {
    this.teardownConnection(true, true);
    this.offlineGuard?.unlock();
  }
}
