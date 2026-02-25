import { Plugin, Notice } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS, ConnectionStatus } from './types';
import { SocketClient } from './socket';
import { SyncEngine } from './syncEngine';
import { WriteInterceptor } from './writeInterceptor';
import { PresenceManager } from './presenceManager';
import { OfflineGuard } from './offlineGuard';
import { HiveSettingTab } from './settings';
import { getUserColor, normalizeCursorColor } from './cursorColor';
import { decodeDiscordUserFromToken } from './main/jwt';
import { bindHiveSocketEvents } from './main/socketEvents';
import { CollabWorkspaceManager } from './main/collabWorkspaceManager';

export default class HivePlugin extends Plugin {
  settings: PluginSettings;

  private settingsTab: HiveSettingTab | null = null;
  private socket: SocketClient | null = null;
  private syncEngine: SyncEngine | null = null;
  private writeInterceptor: WriteInterceptor | null = null;
  private presenceManager: PresenceManager | null = null;
  private offlineGuard: OfflineGuard | null = null;
  private collabWorkspace: CollabWorkspaceManager | null = null;
  private statusBarItem: HTMLElement;
  private status: ConnectionStatus = 'disconnected';
  private isConnecting = false;
  private suppressNextDisconnect = false;

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

    if (this.settings.token) {
      await this.connect();
    } else {
      this.setStatus('auth-required');
      this.offlineGuard.lock('signed-out');
    }
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
    this.presenceManager = new PresenceManager(this.settings);
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
          await this.syncEngine!.initialSync();
        } catch (err) {
          console.error('[Hive] Initial sync failed:', err);
          new Notice(`Hive: Sync failed — ${(err as Error).message}`);
        }

        this.writeInterceptor!.register();
        await this.collabWorkspace?.syncOpenLeavesNow();
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
      },

      onPresenceFileOpened: ({ relPath, user }) => {
        this.presenceManager!.handleFileOpened(relPath, user);
      },

      onPresenceFileClosed: ({ relPath, user }) => {
        this.presenceManager!.handleFileClosed(relPath, user.id);
      },
    });
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

  private teardownConnection(unlockGuard: boolean, suppressDisconnectEvent = false): void {
    this.isConnecting = false;
    this.collabWorkspace?.resetSyncState();

    this.writeInterceptor?.unregister();
    this.writeInterceptor = null;

    this.collabWorkspace?.destroyAllCollabEditors();

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

  onunload(): void {
    this.teardownConnection(true, true);
    this.offlineGuard?.unlock();
  }
}
