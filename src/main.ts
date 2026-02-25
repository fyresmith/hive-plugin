import { Plugin, Notice, TFile } from 'obsidian';
import {
  PluginSettings,
  DEFAULT_SETTINGS,
  ConnectionStatus,
  ManagedVaultBinding,
} from './types';
import { SocketClient } from './socket';
import { SyncEngine, isAllowed } from './syncEngine';
import { WriteInterceptor } from './writeInterceptor';
import { PresenceManager } from './presenceManager';
import { OfflineGuard } from './offlineGuard';
import { HiveSettingTab } from './settings';
import { getUserColor, normalizeCursorColor } from './cursorColor';
import { decodeDiscordUserFromToken } from './main/jwt';
import { bindHiveSocketEvents } from './main/socketEvents';
import { CollabWorkspaceManager } from './main/collabWorkspaceManager';
import { ReconnectBanner } from './ui/reconnectBanner';
import { HiveUsersPanel, HIVE_USERS_VIEW } from './ui/usersPanel';
import { promptForText } from './ui/textPromptModal';
import {
  assertAbsolutePath,
  bootstrapManagedVault,
  coerceServerUrl,
  createManagedBinding,
  getCurrentVaultBasePath,
  ManagedApiClient,
  normalizeServerUrl,
  readManagedBinding,
  showManualOpenNotice,
  tryOpenVault,
} from './main/managedVault';

export default class HivePlugin extends Plugin {
  settings: PluginSettings;

  private settingsTab: HiveSettingTab | null = null;
  private managedBinding: ManagedVaultBinding | null = null;
  private socket: SocketClient | null = null;
  private syncEngine: SyncEngine | null = null;
  private writeInterceptor: WriteInterceptor | null = null;
  presenceManager: PresenceManager | null = null;
  private offlineGuard: OfflineGuard | null = null;
  private collabWorkspace: CollabWorkspaceManager | null = null;
  private statusBarItem: HTMLElement;
  private followStatusBarItem: HTMLElement | null = null;
  private status: ConnectionStatus = 'disconnected';
  private isConnecting = false;

  private reconnectBanner = new ReconnectBanner();
  private disconnectGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DISCONNECT_GRACE_MS = 8000;

  followTargetId: string | null = null;

  private async disablePluginFromUi(): Promise<void> {
    const plugins = (this.app as any).plugins;
    if (plugins?.disablePlugin && typeof this.manifest.id === 'string') {
      await plugins.disablePlugin(this.manifest.id);
      return;
    }

    this.teardownConnection(true);
    this.offlineGuard?.unlock();
    new Notice('Hive: Please disable the plugin from Obsidian settings.');
  }

  private openSettingsTab(): void {
    const setting = (this.app as any).setting;
    if (typeof setting?.open === 'function') {
      setting.open();
    }
    if (typeof setting?.openTabById === 'function') {
      setting.openTabById(this.manifest.id);
    }
  }

  async onload(): Promise<void> {
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);

    let needsSave = false;
    if ((this.settings as any).enabled !== undefined) {
      delete (this.settings as any).enabled;
      needsSave = true;
    }
    if (!this.settings.bootstrapServerUrl) {
      this.settings.bootstrapServerUrl = this.settings.serverUrl;
      needsSave = true;
    }

    this.managedBinding = await readManagedBinding(this.app.vault.adapter);
    if (this.managedBinding) {
      if (this.settings.serverUrl !== this.managedBinding.serverUrl) {
        this.settings.serverUrl = this.managedBinding.serverUrl;
        needsSave = true;
      }
      if (!this.settings.bootstrapServerUrl) {
        this.settings.bootstrapServerUrl = this.managedBinding.serverUrl;
        needsSave = true;
      }
    }

    if (needsSave) {
      await this.saveSettings();
    }

    this.settingsTab = new HiveSettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.style.cursor = 'pointer';
    this.statusBarItem.addEventListener('click', () => {
      if (this.isManagedVault()) {
        void this.revealUsersPanel();
      } else {
        this.openSettingsTab();
      }
    });

    this.followStatusBarItem = this.addStatusBarItem();
    this.followStatusBarItem.style.display = 'none';
    this.followStatusBarItem.title = 'Click to stop following';
    this.followStatusBarItem.style.cursor = 'pointer';
    this.followStatusBarItem.addEventListener('click', () => this.setFollowTarget(null));

    this.registerObsidianProtocolHandler('hive-auth', async (params) => {
      const token = params.token as string;
      if (!token) return;

      try {
        const user = decodeDiscordUserFromToken(token);
        this.settings.token = token;
        this.settings.user = user;
        await this.saveSettings();

        new Notice(`Hive: Logged in as @${user.username}`);
        if (this.isManagedVault()) {
          await this.connect();
        } else {
          this.setStatus('disconnected');
        }
      } catch (err) {
        console.error('[Hive] Failed to process auth token:', err);
        new Notice('Hive: Authentication failed — invalid token.');
      }
    });

    if (this.isManagedVault()) {
      this.setupManagedRuntime();
      if (this.settings.token) {
        await this.connect();
      } else {
        this.setStatus('auth-required');
        this.offlineGuard?.lock('signed-out');
      }
    } else {
      this.setStatus(this.settings.token ? 'disconnected' : 'auth-required');
    }
  }

  private setupManagedRuntime(): void {
    if (!this.managedBinding) return;

    this.registerView(HIVE_USERS_VIEW, (leaf) => new HiveUsersPanel(leaf, this));
    this.addRibbonIcon('users', 'Hive Users', () => void this.revealUsersPanel());

    this.collabWorkspace = new CollabWorkspaceManager({
      app: this.app,
      isSocketConnected: () => Boolean(this.socket?.connected),
      getSessionConfig: () => ({
        serverUrl: this.managedBinding!.serverUrl,
        vaultId: this.managedBinding!.vaultId,
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
      onSaveUrl: async () => {
        new Notice('Hive: Server URL is fixed by this Managed Vault.');
      },
      onLogout: () => this.logout(),
      getSnapshot: () => ({
        serverUrl: this.managedBinding?.serverUrl ?? this.settings.serverUrl,
        user: this.settings.user,
        isAuthenticated: this.isAuthenticated(),
      }),
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

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!(file instanceof TFile)) return;
        if (!isAllowed(file.path)) return;
        if (!this.socket?.connected) return;

        const hasClaim = Boolean(this.presenceManager?.getClaim(file.path));
        menu.addItem((item) => {
          item
            .setTitle(hasClaim ? 'Unclaim this file' : 'Claim this file')
            .setIcon('lock')
            .onClick(() => {
              if (hasClaim) {
                this.unclaimFile(file.path);
              } else {
                this.claimFile(file.path);
              }
            });
        });
      }),
    );
  }

  isManagedVault(): boolean {
    return Boolean(this.managedBinding);
  }

  getManagedBinding(): ManagedVaultBinding | null {
    return this.managedBinding;
  }

  getBootstrapServerUrl(): string {
    return this.settings.bootstrapServerUrl || this.settings.serverUrl;
  }

  async setBootstrapServerUrl(url: string): Promise<void> {
    const normalized = normalizeServerUrl(url);
    this.settings.bootstrapServerUrl = normalized;
    await this.saveSettings();
  }

  private getManagedBindingOrThrow(): ManagedVaultBinding {
    if (!this.managedBinding) {
      throw new Error('This vault is not a Managed Vault.');
    }
    return this.managedBinding;
  }

  async runManagedVaultBootstrapFlow(): Promise<void> {
    if (this.isManagedVault()) {
      new Notice('Hive: This vault is already managed.');
      return;
    }

    try {
      const initialUrl = this.getBootstrapServerUrl() || 'https://';
      const rawUrl = await promptForText(this.app, {
        title: 'Hive Server URL',
        description: 'Use the server domain for your managed vault.',
        placeholder: 'https://collab.example.com',
        initialValue: initialUrl,
        submitLabel: 'Next',
      });
      if (!rawUrl) return;

      const serverUrl = coerceServerUrl(rawUrl);

      await this.setBootstrapServerUrl(serverUrl);

      if (!this.settings.token || !this.settings.user) {
        this.startLoginFlow(serverUrl);
        new Notice('Hive: Finish Discord login, then run Create / Join Managed Vault again.');
        return;
      }

      const api = new ManagedApiClient(serverUrl, this.settings.token);
      let status = await api.status();

      if (!status.managedInitialized) {
        if (!status.isOwner) {
          throw new Error('Managed vault is not initialized, and this account is not the configured owner.');
        }
        await api.init();
        status = await api.status();
      }

      if (!status.isMember) {
        const inviteCode = await promptForText(this.app, {
          title: 'Invite Code',
          description: 'Enter the invite code created by the vault owner.',
          placeholder: 'code',
          submitLabel: 'Join',
        });
        if (!inviteCode) return;
        await api.pair(inviteCode.trim());
        status = await api.status();
      }

      if (!status.vaultId) {
        throw new Error('Server did not return a vault ID.');
      }

      const destinationInput = await promptForText(this.app, {
        title: 'Destination Folder',
        description: 'Enter an absolute path to an EMPTY folder for the new managed vault.',
        placeholder: '/Users/you/Documents/Hive/MyVault',
        submitLabel: 'Create Vault',
      });
      if (!destinationInput) return;
      const destinationPath = assertAbsolutePath(destinationInput);

      const sourceVaultBasePath = getCurrentVaultBasePath(this.app);
      if (!sourceVaultBasePath) {
        throw new Error('Could not resolve current vault filesystem path.');
      }

      const binding = createManagedBinding(serverUrl, status.vaultId);
      const result = await bootstrapManagedVault({
        pluginId: this.manifest.id,
        sourceVaultBasePath,
        destinationPath,
        serverUrl,
        token: this.settings.token,
        user: this.settings.user,
        binding,
      });

      new Notice(`Hive: Managed Vault created (${result.pulledFiles} file${result.pulledFiles === 1 ? '' : 's'}).`, 7000);
      const switched = await tryOpenVault(this.app, result.destinationPath);
      if (!switched) {
        showManualOpenNotice(result.destinationPath);
      }
    } catch (err) {
      console.error('[Hive] Managed vault bootstrap failed:', err);
      new Notice(`Hive: ${(err as Error).message}`);
    }
  }

  async connect(): Promise<void> {
    if (!this.isManagedVault()) return;
    if (this.socket?.connected || this.isConnecting) return;
    if (!this.settings.token) {
      this.setStatus('auth-required');
      this.offlineGuard?.lock('signed-out');
      return;
    }

    const binding = this.getManagedBindingOrThrow();

    if (this.disconnectGraceTimer !== null) {
      clearTimeout(this.disconnectGraceTimer);
      this.disconnectGraceTimer = null;
    }
    this.reconnectBanner.hide();

    this.isConnecting = true;
    this.setStatus('connecting');
    this.offlineGuard?.lock('connecting');
    this.teardownConnection(false);

    this.socket = new SocketClient(binding.serverUrl, this.settings.token, binding.vaultId);
    this.presenceManager = new PresenceManager(this.settings);

    this.reattachPresenceCallback();

    this.syncEngine = new SyncEngine(this.socket, this.app.vault, {
      localMissingStrategy: 'quarantine',
    });
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
          const syncSummary = await this.syncEngine!.initialSync();
          const total = syncSummary.updated + syncSummary.created + syncSummary.deleted;
          if (total > 0 || syncSummary.quarantined > 0) {
            const parts = [
              syncSummary.updated && `${syncSummary.updated} updated`,
              syncSummary.created && `${syncSummary.created} created`,
              syncSummary.deleted && `${syncSummary.deleted} deleted`,
              syncSummary.quarantined && `${syncSummary.quarantined} quarantined`,
            ].filter(Boolean).join(', ');
            new Notice(`Hive: Synced ${total} file${total !== 1 ? 's' : ''}${parts ? ` (${parts})` : ''}`);
          }
          if (syncSummary.quarantined > 0 && syncSummary.quarantinePath) {
            new Notice(`Hive: Local-only files were moved to ${syncSummary.quarantinePath}`, 9000);
          }
        } catch (err) {
          console.error('[Hive] Initial sync failed:', err);
          new Notice(`Hive: Sync failed — ${(err as Error).message}`);
        }

        this.writeInterceptor!.register();
        await this.collabWorkspace?.syncOpenLeavesNow();
      },

      onDisconnect: () => {
        console.log('[Hive] Disconnected');
        this.isConnecting = false;
        this.setStatus('disconnected');
        this.teardownConnection(false);

        this.reconnectBanner.show(() => void this.reconnectFromUi());
        this.disconnectGraceTimer = setTimeout(() => {
          this.disconnectGraceTimer = null;
          this.reconnectBanner.hide();
          this.offlineGuard?.lock('disconnected');
        }, this.DISCONNECT_GRACE_MS);
      },

      onConnectError: (err) => {
        const msg = err.message ?? '';
        this.isConnecting = false;
        this.offlineGuard?.lock('disconnected');

        if (msg.includes('Invalid token') || msg.includes('No token')) {
          this.teardownConnection(false);
          this.setStatus('auth-required');
          this.offlineGuard?.lock('auth-required');
          new Notice('Hive: Session expired. Please connect with Discord again.');
          return;
        }

      if (msg.includes('paired') || msg.includes('vault')) {
        this.teardownConnection(false);
        this.setStatus('disconnected');
        new Notice(`Hive: Managed Vault access error — ${msg}`);
        return;
      }

      this.setStatus('disconnected');
      if (msg) {
        new Notice(`Hive: Could not connect — ${msg}`);
      } else {
        new Notice('Hive: Could not connect to server.');
      }
    },

      onFileUpdated: ({ relPath, user }) => {
        if (this.collabWorkspace?.hasCollabPath(relPath)) return;
        this.syncEngine!.pullFile(relPath);
        if (user?.username) this.presenceManager?.handleFileUpdated(relPath, user.username);
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
        if (this.followTargetId === user.id) {
          this.setFollowTarget(null);
          new Notice(`Hive: Follow ended — @${user.username} disconnected.`);
        }
      },

      onPresenceFileOpened: ({ relPath, user }) => {
        this.presenceManager!.handleFileOpened(relPath, user);
        if (this.followTargetId === user.id) {
          void this.app.workspace.openLinkText(relPath, '', false);
        }
      },

      onPresenceFileClosed: ({ relPath, user }) => {
        this.presenceManager!.handleFileClosed(relPath, user.id);
      },

      onFileClaimed: ({ relPath, user }) => {
        this.presenceManager?.handleFileClaimed(relPath, user);
      },

      onFileUnclaimed: ({ relPath }) => {
        this.presenceManager?.handleFileUnclaimed(relPath);
      },

      onUserStatusChanged: ({ userId, status }) => {
        this.presenceManager?.handleUserStatusChanged(userId, status);
      },
    });
  }

  private reattachPresenceCallback(): void {
    if (!this.presenceManager) return;
    const leaves = this.app.workspace.getLeavesOfType(HIVE_USERS_VIEW);
    if (leaves.length === 0) return;
    const panel = leaves[0].view as HiveUsersPanel;
    this.presenceManager.onChanged = () => {
      panel.render();
      this.refreshStatusCount();
    };
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

  emitUserStatus(status: string): void {
    if (!this.socket?.connected) return;
    this.socket.emit('user-status-changed', { status });
  }

  claimFile(relPath: string): void {
    if (!this.socket?.connected) return;
    this.socket.emit('file-claim', { relPath });
    const user = this.settings.user;
    if (user) {
      const color = this.getPresenceColor() ?? '#888888';
      this.presenceManager?.handleFileClaimed(relPath, { id: user.id, username: user.username, color });
    }
  }

  unclaimFile(relPath: string): void {
    if (!this.socket?.connected) return;
    this.socket.emit('file-unclaim', { relPath });
    this.presenceManager?.handleFileUnclaimed(relPath);
  }

  setFollowTarget(userId: string | null): void {
    if (userId !== null && userId === this.followTargetId) {
      userId = null;
    }
    this.followTargetId = userId;

    if (userId === null) {
      if (this.followStatusBarItem) this.followStatusBarItem.style.display = 'none';
      return;
    }

    const user = this.presenceManager?.getRemoteUsers().get(userId);
    const username = user?.username ?? userId;
    if (this.followStatusBarItem) {
      this.followStatusBarItem.setText(`↻ @${username}`);
      this.followStatusBarItem.style.display = '';
    }

    if (user && user.openFiles.size > 0) {
      const [firstFile] = user.openFiles;
      void this.app.workspace.openLinkText(firstFile, '', false);
    }
  }

  private async revealUsersPanel(): Promise<void> {
    if (!this.isManagedVault()) return;

    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(HIVE_USERS_VIEW);
    if (leaves.length > 0) {
      workspace.revealLeaf(leaves[0]);
      return;
    }
    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: HIVE_USERS_VIEW, active: true });
      workspace.revealLeaf(leaf);
    }
  }

  private teardownConnection(unlockGuard: boolean): void {
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
      socket.disconnect();
    }

    if (unlockGuard) {
      this.offlineGuard?.unlock();
    }
  }

  private startLoginFlow(url?: string): void {
    let target = normalizeServerUrl(
      url
      ?? this.managedBinding?.serverUrl
      ?? this.settings.bootstrapServerUrl
      ?? this.settings.serverUrl,
    );
    try {
      target = coerceServerUrl(target);
    } catch (err) {
      new Notice(`Hive: ${(err as Error).message}`);
      return;
    }
    void this.setBootstrapServerUrl(target);
    window.open(`${target}/auth/login`, '_blank');
  }

  private refreshSettingsTab(): void {
    const tab = this.settingsTab as HiveSettingTab & { containerEl?: HTMLElement };
    if (tab?.containerEl?.isConnected) {
      tab.display();
    }
  }

  refreshStatusCount(): void {
    this.setStatus(this.status);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;

    if (!this.isManagedVault()) {
      this.statusBarItem.setText(this.settings.token ? '⬡ Hive Setup' : '⛶ Hive Setup');
      this.refreshSettingsTab();
      return;
    }

    const count = this.presenceManager?.getRemoteUserCount() ?? 0;
    const countSuffix = status === 'connected' && count > 0 ? ` · ${count}` : '';
    const labels: Record<ConnectionStatus, string> = {
      connected: `⬢ Hive${countSuffix}`,
      connecting: '⬡ Hive',
      disconnected: '⬡̸ Hive',
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
    if (!this.isManagedVault()) return;

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
    if (!this.isManagedVault()) {
      this.startLoginFlow(this.getBootstrapServerUrl());
      return;
    }

    if (this.status === 'auth-required' || !this.settings.token) {
      this.startLoginFlow(this.managedBinding?.serverUrl);
      return;
    }
    await this.connect();
  }

  async logout(): Promise<void> {
    this.isConnecting = false;
    this.settings.token = null;
    this.settings.user = null;
    await this.saveSettings();

    if (this.isManagedVault()) {
      this.teardownConnection(false);
      this.setStatus('auth-required');
      this.offlineGuard?.lock('signed-out');
      this.reconnectBanner.hide();
      if (this.followStatusBarItem) this.followStatusBarItem.style.display = 'none';
    } else {
      this.setStatus('auth-required');
    }

    new Notice('Hive: Logged out.');
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  onunload(): void {
    this.reconnectBanner.hide();
    if (this.followStatusBarItem) this.followStatusBarItem.style.display = 'none';
    if (this.disconnectGraceTimer !== null) {
      clearTimeout(this.disconnectGraceTimer);
      this.disconnectGraceTimer = null;
    }
    this.teardownConnection(true);
    this.offlineGuard?.unlock();
  }
}
