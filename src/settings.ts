import { App, PluginSettingTab, Setting } from 'obsidian';
import type HivePlugin from './main';
import { normalizeCursorColor, getUserColor } from './collabEditor';

function statusLabel(status: ReturnType<HivePlugin['getStatus']>): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting';
    case 'auth-required':
      return 'Sign in required';
    default:
      return 'Disconnected';
  }
}

export class HiveSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: HivePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('hive-settings');

    containerEl.createEl('h2', { text: 'Hive — Collaborative Vault' });

    const card = containerEl.createDiv({ cls: 'hive-settings-card' });
    const authenticated = this.plugin.isAuthenticated();
    const status = this.plugin.getStatus();

    const badge = card.createEl('div', { cls: 'hive-status-label', text: statusLabel(status) });
    badge.dataset.status = status;

    if (this.plugin.settings.user) {
      const user = this.plugin.settings.user;
      const row = card.createDiv({ cls: 'hive-user-row' });
      const avatar = row.createEl('img', { cls: 'hive-user-avatar' });
      avatar.src = user.avatarUrl;
      avatar.alt = user.username;

      const meta = row.createDiv({ cls: 'hive-user-meta' });
      meta.createEl('div', { cls: 'hive-user-name', text: `@${user.username}` });
    } else {
      card.createEl('div', {
        cls: 'hive-user-empty',
        text: 'Not logged in. Connect with Discord to unlock the vault.',
      });
    }

    const actions = card.createDiv({ cls: 'hive-settings-actions' });
    const connectBtn = actions.createEl('button', {
      cls: 'mod-cta',
      text: authenticated ? 'Reconnect' : 'Connect with Discord',
    });
    connectBtn.disabled = status === 'connecting';
    connectBtn.addEventListener('click', async () => {
      await this.plugin.reconnectFromUi();
      this.display();
    });

    const logoutBtn = actions.createEl('button', {
      text: 'Log out',
    });
    logoutBtn.disabled = !authenticated;
    logoutBtn.addEventListener('click', async () => {
      await this.plugin.logout();
      this.display();
    });

    new Setting(containerEl)
      .setName('Server URL')
      .setDesc('URL of your Hive server (e.g. https://collab.calebmsmith.com)')
      .addText((text) =>
        text
          .setPlaceholder('https://collab.calebmsmith.com')
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value.replace(/\/$/, '');
            await this.plugin.saveSettings();
          })
      );

    // -------------------------------------------------------------------------
    // Presence
    // -------------------------------------------------------------------------
    containerEl.createEl('hr', { cls: 'hive-section-divider' });
    containerEl.createEl('h3', { text: 'Presence' });

    new Setting(containerEl)
      .setName('Show presence avatars')
      .setDesc('Display avatar chips in the file tree when remote users have a file open.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showPresenceAvatars)
          .onChange(async (value) => {
            this.plugin.settings.showPresenceAvatars = value;
            await this.plugin.saveSettings();
          })
      );

    const autoColor = this.plugin.settings.user
      ? getUserColor(this.plugin.settings.user.id)
      : '#61afef';
    const cursorDesc = this.plugin.settings.cursorColor === null
      ? 'Auto — color is derived from your Discord ID.'
      : 'Choose your collaboration cursor and highlight color.';

    new Setting(containerEl)
      .setName('Cursor color')
      .setDesc(cursorDesc)
      .addColorPicker((picker) => {
        picker
          .setValue(this.plugin.settings.cursorColor ?? autoColor)
          .onChange(async (value) => {
            this.plugin.settings.cursorColor = normalizeCursorColor(value);
            await this.plugin.saveSettings();
            this.plugin.updateLocalCursorColor();
          });
      })
      .addExtraButton((btn) =>
        btn
          .setIcon('reset')
          .setTooltip('Use automatic color')
          .onClick(async () => {
            this.plugin.settings.cursorColor = null;
            await this.plugin.saveSettings();
            this.plugin.updateLocalCursorColor();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName('Use profile for cursor')
      .setDesc('Local-only: in your editor, show Discord profile image on cursor hover instead of username label.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useProfileForCursor)
          .onChange(async (value) => {
            this.plugin.settings.useProfileForCursor = value;
            await this.plugin.saveSettings();
            this.plugin.updateLocalCursorColor();
          })
      );
  }
}
