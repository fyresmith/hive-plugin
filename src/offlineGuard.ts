import { setIcon } from 'obsidian';

const OVERLAY_ID = 'hive-offline-overlay';
const MODAL_ID = 'hive-offline-modal';
const BODY_CLASS = 'vault-offline';

type OfflineMode = 'connecting' | 'disconnected' | 'auth-required' | 'signed-out';

interface OfflineGuardOptions {
  onReconnect?: () => void;
  onDisable?: () => void;
  onSaveUrl?: (url: string) => Promise<void>;
  onLogout?: () => Promise<void>;
  getSnapshot?: () => {
    serverUrl: string;
    user: { username: string; avatarUrl: string } | null;
    isAuthenticated: boolean;
  };
}

export class OfflineGuard {
  private locked = false;
  private mode: OfflineMode = 'disconnected';
  private readonly onReconnect?: () => void;
  private readonly onDisable?: () => void;
  private readonly onSaveUrl?: (url: string) => Promise<void>;
  private readonly onLogout?: () => Promise<void>;
  private readonly getSnapshot?: () => {
    serverUrl: string;
    user: { username: string; avatarUrl: string } | null;
    isAuthenticated: boolean;
  };

  constructor(options: OfflineGuardOptions = {}) {
    this.onReconnect = options.onReconnect;
    this.onDisable = options.onDisable;
    this.onSaveUrl = options.onSaveUrl;
    this.onLogout = options.onLogout;
    this.getSnapshot = options.getSnapshot;
  }

  private readonly blockInput = (event: Event): void => {
    if (!this.locked) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(`#${MODAL_ID}`)) return;

    if (event.type === 'keydown' || event.type === 'keyup') {
      event.preventDefault();
      event.stopPropagation();
      (event as KeyboardEvent).stopImmediatePropagation?.();
      return;
    }

    const inWorkspace = Boolean(target?.closest('.workspace'));
    if (!inWorkspace) return;

    event.preventDefault();
    event.stopPropagation();
    (event as InputEvent).stopImmediatePropagation?.();
  };

  private renderModal(): void {
    let overlay = document.getElementById(OVERLAY_ID) as HTMLDivElement | null;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      document.body.appendChild(overlay);
    }

    let modal = document.getElementById(MODAL_ID) as HTMLDivElement | null;
    if (!modal) {
      modal = document.createElement('div');
      modal.id = MODAL_ID;
      overlay.appendChild(modal);
    }

    modal.empty();
    modal.toggleClass('is-connecting', this.mode === 'connecting');

    const iconEl = modal.createDiv({ cls: 'hive-offline-icon' });
    const iconName = this.mode === 'auth-required' || this.mode === 'signed-out'
      ? 'lock'
      : this.mode === 'connecting'
      ? 'loader'
      : 'wifi-off';
    setIcon(iconEl, iconName);

    const title = modal.createEl('h3', { cls: 'hive-offline-title' });
    const subtitle = modal.createEl('p', { cls: 'hive-offline-subtitle' });

    if (this.mode === 'connecting') {
      title.textContent = 'Connecting to Hive';
      subtitle.textContent = 'Your changes are paused. Reconnect to keep editing.';
      const loader = modal.createDiv({ cls: 'hive-offline-loader' });
      loader.createDiv({ cls: 'hive-offline-loader-dot' });
      loader.createDiv({ cls: 'hive-offline-loader-dot' });
      loader.createDiv({ cls: 'hive-offline-loader-dot' });
    } else if (this.mode === 'auth-required' || this.mode === 'signed-out') {
      title.textContent = 'Sign in required';
      subtitle.textContent = 'Connect with Discord to unlock collaborative editing.';
    } else {
      title.textContent = 'Hive is offline';
      subtitle.textContent = 'Your changes are paused. Reconnect to keep editing.';
    }

    // Inline settings panel
    if (this.getSnapshot) {
      const snapshot = this.getSnapshot();
      const settings = modal.createDiv({ cls: 'hive-offline-settings' });

      const urlLabel = settings.createEl('div', { cls: 'hive-offline-settings-label', text: 'Server URL' });
      void urlLabel; // rendered for layout

      const urlInput = settings.createEl('input', { type: 'text' });
      urlInput.value = snapshot.serverUrl;
      let lastSavedUrl = snapshot.serverUrl;
      urlInput.addEventListener('blur', () => {
        const value = urlInput.value.replace(/\/+$/, '');
        urlInput.value = value;
        if (value !== lastSavedUrl) {
          lastSavedUrl = value;
          void this.onSaveUrl?.(value);
        }
      });

      if (snapshot.isAuthenticated && snapshot.user) {
        const userRow = settings.createDiv({ cls: 'hive-offline-user-row' });
        const avatar = userRow.createEl('img', { cls: 'hive-offline-user-avatar' });
        avatar.src = snapshot.user.avatarUrl;
        avatar.alt = snapshot.user.username;
        userRow.createEl('span', { cls: 'hive-offline-user-name', text: `@${snapshot.user.username}` });
        const logoutBtn = userRow.createEl('button', { text: 'Log out' });
        logoutBtn.addEventListener('click', () => {
          void this.onLogout?.();
        });
      } else {
        settings.createEl('p', { cls: 'hive-offline-not-signed-in', text: 'Not signed in' });
      }
    }

    const actions = modal.createDiv({ cls: 'hive-offline-actions' });

    if (this.mode !== 'connecting') {
      const reconnect = actions.createEl('button', {
        cls: 'mod-cta',
        text: this.mode === 'auth-required' || this.mode === 'signed-out'
          ? 'Connect with Discord'
          : 'Try reconnect',
      });
      reconnect.addEventListener('click', () => this.onReconnect?.());
    }

    const disable = actions.createEl('button', {
      cls: this.mode !== 'connecting' ? 'mod-warning' : '',
      text: 'Disable Hive',
    });
    disable.addEventListener('click', () => this.onDisable?.());
  }

  lock(mode: OfflineMode = 'disconnected'): void {
    this.mode = mode;

    if (this.locked) {
      this.renderModal();
      return;
    }
    this.locked = true;

    document.body.addClass(BODY_CLASS);
    this.renderModal();

    // 'disconnected' mode: show the overlay banner but leave the vault editable
    // so offline edits can be queued for replay on reconnect.
    if (mode === 'disconnected') return;

    window.addEventListener('keydown', this.blockInput, true);
    window.addEventListener('keyup', this.blockInput, true);
    document.addEventListener('beforeinput', this.blockInput, true);
    document.addEventListener('paste', this.blockInput, true);
    document.addEventListener('drop', this.blockInput, true);
    document.addEventListener('cut', this.blockInput, true);
    document.addEventListener('submit', this.blockInput, true);

    // Keep focus out of editors while locked.
    const active = document.activeElement as HTMLElement | null;
    if (active?.blur) active.blur();
  }

  unlock(): void {
    if (!this.locked) return;
    this.locked = false;

    window.removeEventListener('keydown', this.blockInput, true);
    window.removeEventListener('keyup', this.blockInput, true);
    document.removeEventListener('beforeinput', this.blockInput, true);
    document.removeEventListener('paste', this.blockInput, true);
    document.removeEventListener('drop', this.blockInput, true);
    document.removeEventListener('cut', this.blockInput, true);
    document.removeEventListener('submit', this.blockInput, true);

    document.body.removeClass(BODY_CLASS);
    document.getElementById(OVERLAY_ID)?.remove();
  }
}
