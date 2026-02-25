import { TFile, Vault, Notice } from 'obsidian';
import { SocketClient, SocketRequestError } from './socket';
import { SyncEngine, hashContent, isAllowed } from './syncEngine';
import { isSuppressed, suppress, unsuppress } from './suppressedPaths';

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
      await this.revertFile(file, 'Vault is offline — change reverted.');
      return;
    }

    try {
      const content = await this.vault.read(file);
      const expectedHash = this.syncEngine.getKnownHash(file.path);
      const payload: { relPath: string; content: string; expectedHash?: string } = {
        relPath: file.path,
        content,
      };
      if (expectedHash) {
        payload.expectedHash = expectedHash;
      }
      const res = await this.socket.request<{ hash: string }>('file-write', payload);
      this.syncEngine.recordKnownState(file.path, content, res.hash);
    } catch (err) {
      if (err instanceof SocketRequestError && err.code === 'CONFLICT') {
        await this.syncEngine.pullFile(file.path);
        new Notice('Hive: File changed remotely. Pulled latest version; reapply your edits.');
        return;
      }
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
      suppress(file.path);
      try {
        await this.vault.delete(file);
      } finally {
        unsuppress(file.path);
      }
      new Notice('Hive: Vault is offline — new file removed.');
      return;
    }

    try {
      const content = await this.vault.read(file);
      const res = await this.socket.request<{ hash?: string }>('file-create', { relPath: file.path, content });
      const hash = typeof res.hash === 'string' ? res.hash : hashContent(content);
      this.syncEngine.recordKnownState(file.path, content, hash);
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
      // Restore from cache
      const cached = this.syncEngine.fileCache.get(file.path);
      if (cached !== undefined) {
        suppress(file.path);
        try {
          await this.vault.create(file.path, cached);
        } finally {
          unsuppress(file.path);
        }
      }
      new Notice('Hive: Vault is offline — delete reverted.');
      return;
    }

    try {
      await this.socket.request('file-delete', file.path);
      this.syncEngine.clearKnownState(file.path);
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
      // Revert: rename back to old path
      suppress(file.path);
      suppress(oldPath);
      try {
        await this.vault.rename(file, oldPath);
      } finally {
        unsuppress(file.path);
        unsuppress(oldPath);
      }
      new Notice('Hive: Vault is offline — rename reverted.');
      return;
    }

    try {
      await this.socket.request('file-rename', { oldPath, newPath: file.path });
      const cached = this.syncEngine.fileCache.get(oldPath);
      const knownHash = this.syncEngine.getKnownHash(oldPath);
      if (cached !== undefined && knownHash) {
        this.syncEngine.recordKnownState(file.path, cached, knownHash);
      } else if (cached !== undefined) {
        this.syncEngine.recordKnownState(file.path, cached, hashContent(cached));
      }
      this.syncEngine.clearKnownState(oldPath);
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
