import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type HivePlugin from '../main';
import type { RemoteUser } from '../types';

export const HIVE_USERS_VIEW = 'hive-users-panel';

/** Returns just the filename portion of a vault-relative path. */
function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

// ---------------------------------------------------------------------------
// HiveUsersPanel
// ---------------------------------------------------------------------------

export class HiveUsersPanel extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: HivePlugin) {
    super(leaf);
  }

  getViewType(): string  { return HIVE_USERS_VIEW; }
  getDisplayText(): string { return 'Hive — Users'; }
  getIcon(): string { return 'users'; }

  async onOpen(): Promise<void> {
    if (this.plugin.presenceManager) {
      this.plugin.presenceManager.onChanged = () => {
        this.render();
        this.plugin.refreshStatusCount();
      };
    }
    this.render();
  }

  async onClose(): Promise<void> {
    if (this.plugin.presenceManager) {
      this.plugin.presenceManager.onChanged = undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Top-level render
  // ---------------------------------------------------------------------------

  render(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.className = 'hive-users-panel';

    this.renderConnectionHeader(root);

    // "You" section always renders so the user can see / set their status.
    this.renderSection(root, 'You', null, (s) => this.renderSelfCard(s));

    const pm    = this.plugin.presenceManager;
    const status = this.plugin.getStatus();

    if (!pm || status !== 'connected') {
      this.renderDisconnectedState(root, status);
      return;
    }

    const remoteUsers = pm.getRemoteUsers();
    this.renderSection(root, 'Teammates', remoteUsers.size || null, (s) => {
      if (remoteUsers.size === 0) {
        s.createDiv({ cls: 'hive-panel-empty-hint', text: 'No one else is online yet.' });
        return;
      }
      for (const [userId, user] of remoteUsers) {
        this.renderUserCard(s, userId, user);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Connection header
  // ---------------------------------------------------------------------------

  private renderConnectionHeader(root: HTMLElement): void {
    const header = root.createDiv({ cls: 'hive-panel-conn-header' });
    const status  = this.plugin.getStatus();
    const pm      = this.plugin.presenceManager;

    const dot = header.createSpan({ cls: 'hive-conn-dot' });

    if (status === 'connected') {
      dot.addClass('is-connected');
      const total = (pm?.getRemoteUserCount() ?? 0) + 1; // include self
      header.createSpan({ text: total === 1 ? 'Only you in session' : `${total} in session` });
    } else if (status === 'connecting') {
      dot.addClass('is-connecting');
      header.createSpan({ text: 'Connecting…' });
    } else if (status === 'auth-required') {
      header.createSpan({ text: 'Not signed in' });
    } else {
      header.createSpan({ text: 'Not connected' });
    }
  }

  // ---------------------------------------------------------------------------
  // Section wrapper
  // ---------------------------------------------------------------------------

  private renderSection(
    root: HTMLElement,
    label: string,
    count: number | null,
    build: (sectionEl: HTMLElement) => void,
  ): void {
    const section  = root.createDiv({ cls: 'hive-panel-section' });
    const labelRow = section.createDiv({ cls: 'hive-panel-section-label' });
    labelRow.createSpan({ text: label });
    if (count !== null) {
      labelRow.createSpan({ cls: 'hive-panel-section-count', text: String(count) });
    }
    build(section);
  }

  // ---------------------------------------------------------------------------
  // Self card
  // ---------------------------------------------------------------------------

  private renderSelfCard(parent: HTMLElement): void {
    const { settings } = this.plugin;
    const card = parent.createDiv({ cls: 'hive-self-card' });

    this.buildAvatar(card, settings.user?.avatarUrl ?? '', settings.user?.username ?? '?', '');

    const info = card.createDiv({ cls: 'hive-self-card-info' });
    info.createSpan({
      cls: 'hive-self-name',
      text: settings.user ? `@${settings.user.username}` : 'You',
    });
  }

  // ---------------------------------------------------------------------------
  // Remote user card
  // ---------------------------------------------------------------------------

  private renderUserCard(parent: HTMLElement, userId: string, user: RemoteUser): void {
    const isFollowing = this.plugin.followTargetId === userId;

    const card = parent.createDiv({ cls: 'hive-user-card' });
    if (isFollowing) card.addClass('is-following');
    card.style.setProperty('--user-color', user.color);

    // ── Header row ────────────────────────────────────────────────────────────
    const header = card.createDiv({ cls: 'hive-user-card-header' });

    this.buildAvatar(header, user.avatarUrl, user.username, user.color);

    const info = header.createDiv({ cls: 'hive-user-card-info' });
    info.createSpan({ cls: 'hive-user-card-name', text: `@${user.username}` });

    // ── Action buttons ────────────────────────────────────────────────────────
    const actions = header.createDiv({ cls: 'hive-user-card-actions' });
    this.buildFollowButton(actions, userId, isFollowing);

    // ── File chips ────────────────────────────────────────────────────────────
    if (user.openFiles.size > 0) {
      this.renderFileChips(card, [...user.openFiles]);
    }
  }

  private buildFollowButton(parent: HTMLElement, userId: string, isFollowing: boolean): void {
    const btn = parent.createEl('button', {
      cls: 'hive-user-card-action' + (isFollowing ? ' is-active' : ''),
    });
    btn.title = isFollowing ? 'Stop following' : 'Follow';
    setIcon(btn, isFollowing ? 'user-check' : 'user-plus');
    btn.addEventListener('click', () => {
      this.plugin.setFollowTarget(isFollowing ? null : userId);
      this.render();
    });
  }

  private renderFileChips(card: HTMLElement, files: string[]): void {
    const row = card.createDiv({ cls: 'hive-user-card-files' });
    for (const filePath of files) {
      const chip = row.createEl('button', { cls: 'hive-file-chip' });
      chip.title = filePath;
      const iconEl = chip.createSpan({ cls: 'hive-file-chip-icon' });
      setIcon(iconEl, 'file');
      chip.createSpan({ cls: 'hive-file-chip-name', text: basename(filePath) });
      chip.addEventListener('click', () => {
        void this.plugin.app.workspace.openLinkText(filePath, '', false);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Disconnected / unauthenticated state
  // ---------------------------------------------------------------------------

  private renderDisconnectedState(root: HTMLElement, status: string): void {
    const wrap = root.createDiv({ cls: 'hive-panel-disconnected' });

    const icon = wrap.createDiv({ cls: 'hive-panel-disconnected-icon' });
    setIcon(icon, 'wifi-off');

    if (status === 'auth-required') {
      wrap.createDiv({ cls: 'hive-panel-disconnected-text', text: 'Sign in with Discord to collaborate.' });
      const btn = wrap.createEl('button', { cls: 'hive-panel-connect-btn', text: 'Sign in' });
      btn.addEventListener('click', () => void this.plugin.reconnectFromUi());
    } else if (status === 'connecting') {
      wrap.createDiv({ cls: 'hive-panel-disconnected-text', text: 'Connecting to session…' });
    } else {
      wrap.createDiv({ cls: 'hive-panel-disconnected-text', text: 'Lost connection to session.' });
      const btn = wrap.createEl('button', { cls: 'hive-panel-connect-btn', text: 'Reconnect' });
      btn.addEventListener('click', () => void this.plugin.reconnectFromUi());
    }
  }

  // ---------------------------------------------------------------------------
  // Shared avatar builder
  // ---------------------------------------------------------------------------

  private buildAvatar(parent: HTMLElement, avatarUrl: string, username: string, color: string): void {
    if (!avatarUrl) {
      this.makeFallbackAvatar(parent, username, color);
      return;
    }

    const img = parent.createEl('img', { cls: 'hive-user-card-avatar', attr: { alt: username } });
    img.src = avatarUrl;
    img.onerror = () => {
      const fallback = this.makeFallbackAvatar(null, username, color);
      img.replaceWith(fallback);
    };
  }

  private makeFallbackAvatar(parent: HTMLElement | null, username: string, color: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'hive-user-avatar-fallback';
    el.textContent = (username || '?').charAt(0).toUpperCase();
    if (color) el.style.backgroundColor = color;
    if (parent) parent.appendChild(el);
    return el;
  }
}
