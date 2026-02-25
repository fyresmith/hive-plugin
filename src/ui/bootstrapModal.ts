import { App, Modal } from 'obsidian';
import type { DiscordUser } from '../types';
import {
  assertAbsolutePath,
  bootstrapManagedVault,
  coerceServerUrl,
  createManagedBinding,
  getCurrentVaultBasePath,
  ManagedApiClient,
  showManualOpenNotice,
  tryOpenVault,
} from '../main/managedVault';

interface BootstrapModalOptions {
  initialServerUrl: string;
  token: string;
  user: DiscordUser;
  pluginId: string;
  onServerUrlSaved: (url: string) => Promise<void>;
  onComplete: () => void;
}

export class BootstrapModal extends Modal {
  private errorEl: HTMLElement;
  private submitBtn: HTMLButtonElement;
  private serverUrlInput: HTMLInputElement;
  private inviteCodeInput: HTMLInputElement;
  private destinationInput: HTMLInputElement;

  constructor(app: App, private opts: BootstrapModalOptions) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('hive-bootstrap-modal');

    contentEl.createEl('h2', { text: 'Create / Join Managed Vault' });

    // Server URL
    const urlLabel = contentEl.createEl('label', { text: 'Server URL' });
    urlLabel.addClass('hive-form-label');
    this.serverUrlInput = contentEl.createEl('input', { type: 'text' });
    this.serverUrlInput.addClass('hive-form-input');
    this.serverUrlInput.value = this.opts.initialServerUrl;
    this.serverUrlInput.placeholder = 'https://collab.example.com';

    // Invite code
    const codeLabel = contentEl.createEl('label', { text: 'Invite code (optional for vault owners)' });
    codeLabel.addClass('hive-form-label');
    this.inviteCodeInput = contentEl.createEl('input', { type: 'text' });
    this.inviteCodeInput.addClass('hive-form-input');
    this.inviteCodeInput.placeholder = 'Leave blank if you are the vault owner';

    // Destination path
    const destLabel = contentEl.createEl('label', { text: 'Destination folder (empty, absolute path)' });
    destLabel.addClass('hive-form-label');
    this.destinationInput = contentEl.createEl('input', { type: 'text' });
    this.destinationInput.addClass('hive-form-input');
    this.destinationInput.placeholder = '/Users/you/Documents/MyVault';

    // Error area
    this.errorEl = contentEl.createEl('p', { cls: 'hive-form-error' });
    this.errorEl.style.display = 'none';

    // Actions
    const actions = contentEl.createDiv({ cls: 'hive-form-actions' });
    this.submitBtn = actions.createEl('button', { cls: 'mod-cta', text: 'Create Vault' });
    this.submitBtn.addEventListener('click', () => void this.onSubmit());

    const cancelBtn = actions.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private showError(msg: string): void {
    this.errorEl.textContent = msg;
    this.errorEl.style.display = '';
  }

  private clearError(): void {
    this.errorEl.style.display = 'none';
  }

  private setLoading(loading: boolean): void {
    this.submitBtn.disabled = loading;
    this.submitBtn.textContent = loading ? 'Working…' : 'Create Vault';
  }

  private async onSubmit(): Promise<void> {
    this.clearError();

    let serverUrl: string;
    try {
      serverUrl = coerceServerUrl(this.serverUrlInput.value);
    } catch (err) {
      this.showError((err as Error).message);
      return;
    }

    const inviteCode = this.inviteCodeInput.value.trim();

    let destinationPath: string;
    try {
      destinationPath = assertAbsolutePath(this.destinationInput.value.trim());
    } catch (err) {
      this.showError((err as Error).message);
      return;
    }

    this.setLoading(true);
    try {
      await this.opts.onServerUrlSaved(serverUrl);

      const api = new ManagedApiClient(serverUrl, this.opts.token);
      let status = await api.status();

      if (!status.managedInitialized) {
        if (!status.isOwner) {
          this.showError('Managed vault is not initialized and this account is not the configured owner.');
          return;
        }
        await api.init();
        status = await api.status();
      }

      if (!status.isMember) {
        if (!inviteCode) {
          this.showError('You are not a member of this vault. Enter an invite code to join.');
          return;
        }
        await api.pair(inviteCode);
        status = await api.status();
      }

      if (!status.vaultId) {
        this.showError('Server did not return a vault ID.');
        return;
      }

      const sourceVaultBasePath = getCurrentVaultBasePath(this.app);
      if (!sourceVaultBasePath) {
        this.showError('Could not resolve current vault filesystem path.');
        return;
      }

      const binding = createManagedBinding(serverUrl, status.vaultId);
      const result = await bootstrapManagedVault({
        pluginId: this.opts.pluginId,
        sourceVaultBasePath,
        destinationPath,
        serverUrl,
        token: this.opts.token,
        user: this.opts.user,
        binding,
      });

      this.close();
      this.opts.onComplete();
      const switched = await tryOpenVault(this.app, result.destinationPath);
      if (!switched) {
        showManualOpenNotice(result.destinationPath);
      }
    } catch (err) {
      this.showError((err as Error).message);
    } finally {
      this.setLoading(false);
    }
  }
}
