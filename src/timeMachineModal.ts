import { App, Modal, Notice } from 'obsidian';

export interface FileHistoryVersionMeta {
  versionId: string;
  relPath: string;
  ts: number;
  action: string;
  hash: string;
  size: number;
  actor?: { id?: string | null; username?: string | null } | null;
  source?: string | null;
}

export interface FileHistoryVersionRecord extends FileHistoryVersionMeta {
  content: string;
}

interface TimeMachineModalOptions {
  relPath: string;
  fetchHistory: (relPath: string) => Promise<FileHistoryVersionMeta[]>;
  fetchVersion: (relPath: string, versionId: string) => Promise<FileHistoryVersionRecord>;
  restoreVersion: (relPath: string, version: FileHistoryVersionRecord) => Promise<void>;
}

function formatTimestamp(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function formatActor(meta: FileHistoryVersionMeta): string {
  const username = meta.actor?.username?.trim();
  if (username) return `@${username}`;
  return meta.source ?? 'system';
}

export class TimeMachineModal extends Modal {
  private versions: FileHistoryVersionMeta[] = [];
  private selectedVersion: FileHistoryVersionRecord | null = null;
  private selectedVersionId: string | null = null;
  private loadingHistory = false;
  private loadingVersion = false;
  private restoring = false;
  private errorText: string | null = null;

  constructor(
    app: App,
    private readonly options: TimeMachineModalOptions,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(`Hive Time Machine — ${this.options.relPath}`);
    this.modalEl.addClass('hive-time-machine-modal');
    this.render();
    void this.loadHistory();
  }

  onClose(): void {
    this.modalEl.removeClass('hive-time-machine-modal');
    this.contentEl.empty();
  }

  private async loadHistory(): Promise<void> {
    this.loadingHistory = true;
    this.errorText = null;
    this.render();
    try {
      this.versions = await this.options.fetchHistory(this.options.relPath);
      if (this.versions.length > 0) {
        await this.loadVersion(this.versions[0].versionId);
      } else {
        this.selectedVersion = null;
        this.selectedVersionId = null;
      }
    } catch (err) {
      this.errorText = (err as Error).message;
    } finally {
      this.loadingHistory = false;
      this.render();
    }
  }

  private async loadVersion(versionId: string): Promise<void> {
    this.loadingVersion = true;
    this.errorText = null;
    this.selectedVersionId = versionId;
    this.render();
    try {
      this.selectedVersion = await this.options.fetchVersion(this.options.relPath, versionId);
    } catch (err) {
      this.errorText = (err as Error).message;
      this.selectedVersion = null;
    } finally {
      this.loadingVersion = false;
      this.render();
    }
  }

  private async restoreSelectedVersion(): Promise<void> {
    if (!this.selectedVersion || this.restoring) return;
    this.restoring = true;
    this.render();
    try {
      await this.options.restoreVersion(this.options.relPath, this.selectedVersion);
      new Notice(`Hive: Restored ${this.options.relPath} from ${formatTimestamp(this.selectedVersion.ts)}`);
      this.close();
    } catch (err) {
      this.errorText = (err as Error).message;
      this.render();
    } finally {
      this.restoring = false;
      this.render();
    }
  }

  private render(): void {
    this.contentEl.empty();
    const root = this.contentEl.createDiv({ cls: 'hive-time-machine-root' });

    if (this.errorText) {
      root.createDiv({ cls: 'hive-time-machine-error', text: this.errorText });
    }

    const body = root.createDiv({ cls: 'hive-time-machine-body' });
    const listCol = body.createDiv({ cls: 'hive-time-machine-list' });
    const previewCol = body.createDiv({ cls: 'hive-time-machine-preview' });

    if (this.loadingHistory) {
      listCol.createDiv({ cls: 'hive-time-machine-empty', text: 'Loading versions…' });
    } else if (this.versions.length === 0) {
      listCol.createDiv({ cls: 'hive-time-machine-empty', text: 'No history yet for this file.' });
    } else {
      for (const version of this.versions) {
        const item = listCol.createEl('button', { cls: 'hive-time-machine-item' });
        if (this.selectedVersionId === version.versionId) {
          item.addClass('is-active');
        }
        item.type = 'button';
        item.createDiv({
          cls: 'hive-time-machine-item-title',
          text: `${formatTimestamp(version.ts)} · ${version.action}`,
        });
        item.createDiv({
          cls: 'hive-time-machine-item-meta',
          text: `${formatActor(version)} · ${version.hash.slice(0, 12)} · ${version.size} bytes`,
        });
        item.addEventListener('click', () => {
          void this.loadVersion(version.versionId);
        });
      }
    }

    if (this.loadingVersion) {
      previewCol.createDiv({ cls: 'hive-time-machine-empty', text: 'Loading snapshot…' });
      return;
    }

    if (!this.selectedVersion) {
      previewCol.createDiv({ cls: 'hive-time-machine-empty', text: 'Select a version to preview.' });
      return;
    }

    const selected = this.selectedVersion;
    previewCol.createDiv({
      cls: 'hive-time-machine-preview-meta',
      text: `${formatTimestamp(selected.ts)} · ${selected.action} · ${selected.hash}`,
    });

    const pre = previewCol.createEl('pre', { cls: 'hive-time-machine-content' });
    pre.textContent = selected.content;

    const actions = previewCol.createDiv({ cls: 'hive-time-machine-actions' });
    const copyBtn = actions.createEl('button', { text: 'Copy snapshot' });
    copyBtn.type = 'button';
    copyBtn.disabled = this.restoring;
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(selected.content);
        new Notice('Hive: Snapshot copied to clipboard.');
      } catch {
        new Notice('Hive: Failed to copy snapshot.');
      }
    });

    const restoreBtn = actions.createEl('button', { cls: 'mod-warning', text: 'Restore this version' });
    restoreBtn.type = 'button';
    restoreBtn.disabled = this.restoring;
    restoreBtn.addEventListener('click', () => {
      void this.restoreSelectedVersion();
    });
  }
}
