import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type HivePlugin from './main';

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

  private renderUserCard(parent: HTMLElement): void {
    if (this.plugin.settings.user) {
      const user = this.plugin.settings.user;
      const row = parent.createDiv({ cls: 'hive-user-row' });
      const avatar = row.createEl('img', { cls: 'hive-user-avatar' });
      avatar.src = user.avatarUrl;
      avatar.alt = user.username;

      const meta = row.createDiv({ cls: 'hive-user-meta' });
      meta.createEl('div', { cls: 'hive-user-name', text: `@${user.username}` });
      return;
    }

    parent.createEl('div', {
      cls: 'hive-user-empty',
      text: 'Not signed in.',
    });
  }

  private renderManagedSettings(containerEl: HTMLElement): void {
    const status = this.plugin.getStatus();
    const card = containerEl.createDiv({ cls: 'hive-settings-card' });
    const badge = card.createEl('div', { cls: 'hive-status-label', text: statusLabel(status) });
    badge.dataset.status = status;

    this.renderUserCard(card);

    const binding = this.plugin.getManagedBinding();
    const details = card.createDiv({ cls: 'hive-user-meta' });
    details.createEl('div', { cls: 'hive-user-name', text: `Vault ID: ${binding?.vaultId ?? '(missing)'}` });
    details.createEl('div', { text: `Server: ${binding?.serverUrl ?? '(missing)'}` });

    const actions = card.createDiv({ cls: 'hive-settings-actions' });
    const connectBtn = actions.createEl('button', {
      cls: 'mod-cta',
      text: this.plugin.isAuthenticated() ? 'Reconnect' : 'Connect with Discord',
    });
    connectBtn.disabled = status === 'connecting';
    connectBtn.addEventListener('click', async () => {
      await this.plugin.reconnectFromUi();
      this.display();
    });

    const logoutBtn = actions.createEl('button', { text: 'Log out' });
    logoutBtn.disabled = !this.plugin.isAuthenticated();
    logoutBtn.addEventListener('click', async () => {
      await this.plugin.logout();
      this.display();
    });

    containerEl.createEl('hr', { cls: 'hive-section-divider' });
    containerEl.createEl('h3', { text: 'Diagnostics' });
    containerEl.createEl('p', { text: `Mode: Managed Vault` });
    containerEl.createEl('p', { text: `Connection: ${statusLabel(status)}` });
  }

  private renderBootstrapSettings(containerEl: HTMLElement): void {
    const status = this.plugin.getStatus();
    const card = containerEl.createDiv({ cls: 'hive-settings-card' });
    const badge = card.createEl('div', { cls: 'hive-status-label', text: 'Setup required' });
    badge.dataset.status = status;

    card.createEl('div', {
      cls: 'hive-user-empty',
      text: 'Hive runs only inside Managed Vaults. Create or join one below.',
    });

    this.renderUserCard(card);

    new Setting(containerEl)
      .setName('Server URL')
      .setDesc('Hive server URL used for Managed Vault creation/join')
      .addText((text) =>
        text
          .setPlaceholder('https://collab.example.com')
          .setValue(this.plugin.getBootstrapServerUrl())
          .onChange(async (value) => {
            await this.plugin.setBootstrapServerUrl(value);
          })
      );

    const actions = card.createDiv({ cls: 'hive-settings-actions' });
    const connectBtn = actions.createEl('button', {
      cls: 'mod-cta',
      text: this.plugin.isAuthenticated() ? 'Reconnect Discord' : 'Connect with Discord',
    });
    connectBtn.addEventListener('click', async () => {
      await this.plugin.reconnectFromUi();
      this.display();
    });

    const bootstrapBtn = actions.createEl('button', {
      cls: 'mod-cta',
      text: 'Create / Join Managed Vault',
    });
    bootstrapBtn.addEventListener('click', async () => {
      try {
        await this.plugin.runManagedVaultBootstrapFlow();
      } catch (err) {
        console.error('[Hive] Bootstrap flow failed:', err);
        new Notice(`Hive: ${(err as Error).message}`);
      }
      this.display();
    });

    const logoutBtn = actions.createEl('button', { text: 'Log out' });
    logoutBtn.disabled = !this.plugin.isAuthenticated();
    logoutBtn.addEventListener('click', async () => {
      await this.plugin.logout();
      this.display();
    });

    containerEl.createEl('hr', { cls: 'hive-section-divider' });
    containerEl.createEl('h3', { text: 'Diagnostics' });
    containerEl.createEl('p', { text: 'Mode: Setup (unmanaged vault)' });
    containerEl.createEl('p', { text: `Auth: ${this.plugin.isAuthenticated() ? 'Signed in' : 'Signed out'}` });
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('hive-settings');

    containerEl.createEl('h2', { text: 'Hive — Managed Vault' });

    if (this.plugin.isManagedVault()) {
      this.renderManagedSettings(containerEl);
      return;
    }

    this.renderBootstrapSettings(containerEl);
  }
}
