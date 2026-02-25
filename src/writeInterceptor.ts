import { TFile, Vault, Notice } from 'obsidian';
import { SocketClient } from './socket';
import { SyncEngine, isAllowed } from './syncEngine';
import { isSuppressed, suppress, unsuppress } from './suppressedPaths';
import { OfflineQueue } from './offlineQueue';

export class WriteInterceptor {
  private onModifyRef: (file: TFile) => void;
  private onCreateRef: (file: TFile) => void;
  private onDeleteRef: (file: TFile) => void;
  private onRenameRef: (file: TFile, oldPath: string) => void;

  constructor(
    private socket: SocketClient,
    private vault: Vault,
    private syncEngine: SyncEngine,
    private getCollabPaths: () => Set<string>,
    private offlineQueue?: OfflineQueue,
  ) {
    this.onModifyRef = this.onModify.bind(this);
    this.onCreateRef = this.onCreate.bind(this);
    this.onDeleteRef = this.onDelete.bind(this);
    this.onRenameRef = this.onRename.bind(this);
  }

  register(): void {
    this.vault.on('modify', this.onModifyRef);
    this.vault.on('create', this.onCreateRef);
    this.vault.on('delete', this.onDeleteRef);
    this.vault.on('rename', this.onRenameRef);
  }

  unregister(): void {
    this.vault.off('modify', this.onModifyRef);
    this.vault.off('create', this.onCreateRef);
    this.vault.off('delete', this.onDeleteRef);
    this.vault.off('rename', this.onRenameRef);
  }

  // ---------------------------------------------------------------------------
  // modify
  // ---------------------------------------------------------------------------

  private async onModify(file: TFile): Promise<void> {
    if (isSuppressed(file.path)) return;
    if (!isAllowed(file.path)) return;
    // Yjs owns this file — skip entirely
    if (this.getCollabPaths().has(file.path)) return;

    if (!this.socket.connected) {
      if (this.offlineQueue) {
        const content = await this.vault.read(file);
        this.offlineQueue.enqueue({ type: 'modify', path: file.path, content });
      }
      return;
    }

    try {
      const content = await this.vault.read(file);
      await this.socket.request<{ hash: string }>('file-write', {
        relPath: file.path,
        content,
      });
      this.syncEngine.fileCache.set(file.path, content);
    } catch (err) {
      console.error(`[intercept] modify error (${file.path}):`, err);
      await this.revertFile(file, `Hive: Write failed — reverting. ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  private async onCreate(file: TFile): Promise<void> {
    if (isSuppressed(file.path)) return;
    if (!isAllowed(file.path)) return;

    if (!this.socket.connected) {
      if (this.offlineQueue) {
        const content = await this.vault.read(file);
        this.offlineQueue.enqueue({ type: 'create', path: file.path, content });
      }
      return;
    }

    try {
      const content = await this.vault.read(file);
      await this.socket.request('file-create', { relPath: file.path, content });
      this.syncEngine.fileCache.set(file.path, content);
    } catch (err) {
      console.error(`[intercept] create error (${file.path}):`, err);
      new Notice(`Hive: Create failed. ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // delete
  // ---------------------------------------------------------------------------

  private async onDelete(file: TFile): Promise<void> {
    if (isSuppressed(file.path)) return;
    if (!isAllowed(file.path)) return;

    if (!this.socket.connected) {
      if (this.offlineQueue) {
        this.offlineQueue.enqueue({ type: 'delete', path: file.path });
      }
      return;
    }

    try {
      await this.socket.request('file-delete', file.path);
      this.syncEngine.fileCache.delete(file.path);
    } catch (err) {
      console.error(`[intercept] delete error (${file.path}):`, err);
      new Notice(`Hive: Delete failed. ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // rename
  // ---------------------------------------------------------------------------

  private async onRename(file: TFile, oldPath: string): Promise<void> {
    if (isSuppressed(file.path) || isSuppressed(oldPath)) return;
    if (!isAllowed(oldPath) && !isAllowed(file.path)) return;

    if (!this.socket.connected) {
      if (this.offlineQueue) {
        this.offlineQueue.enqueue({ type: 'rename', oldPath, newPath: file.path });
      }
      return;
    }

    try {
      await this.socket.request('file-rename', { oldPath, newPath: file.path });
      const cached = this.syncEngine.fileCache.get(oldPath);
      if (cached !== undefined) {
        this.syncEngine.fileCache.set(file.path, cached);
        this.syncEngine.fileCache.delete(oldPath);
      }
    } catch (err) {
      console.error(`[intercept] rename error (${oldPath} → ${file.path}):`, err);
      new Notice(`Hive: Rename failed. ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Helper
  // ---------------------------------------------------------------------------

  private async revertFile(file: TFile, message: string): Promise<void> {
    const cached = this.syncEngine.fileCache.get(file.path);
    if (cached === undefined) return;
    suppress(file.path);
    try {
      await this.vault.modify(file, cached);
    } finally {
      unsuppress(file.path);
    }
    new Notice(`Hive: ${message}`);
  }
}
