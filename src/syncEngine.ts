import { createHash } from 'crypto';
import { TFile, Vault } from 'obsidian';
import { SocketClient } from './socket';
import { ManifestEntry } from './types';
import { suppress, unsuppress } from './suppressedPaths';

const ALLOW_EXTS = new Set(['.md', '.canvas']);
const DENY_PREFIXES = ['.obsidian/', 'Attachments/', '.git/', '.hive/', '.hive-quarantine/'];

export function isAllowed(path: string): boolean {
  for (const prefix of DENY_PREFIXES) {
    if (path.startsWith(prefix)) return false;
  }
  const dot = path.lastIndexOf('.');
  if (dot === -1) return false;
  return ALLOW_EXTS.has(path.slice(dot).toLowerCase());
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

type LocalMissingStrategy = 'delete' | 'quarantine' | 'keep';

interface SyncEngineOptions {
  localMissingStrategy?: LocalMissingStrategy;
}

export class SyncEngine {
  /** Last known content for each file — used for offline reverts. */
  fileCache = new Map<string, string>();
  private readonly localMissingStrategy: LocalMissingStrategy;

  constructor(
    private socket: SocketClient,
    private vault: Vault,
    options: SyncEngineOptions = {},
  ) {
    this.localMissingStrategy = options.localMissingStrategy ?? 'delete';
  }

  // ---------------------------------------------------------------------------
  // Initial sync
  // ---------------------------------------------------------------------------

  async initialSync(): Promise<{
    updated: number;
    created: number;
    deleted: number;
    quarantined: number;
    quarantinePath: string | null;
  }> {
    console.log('[sync] Starting initial sync...');

    const res = await this.socket.request<{ manifest: ManifestEntry[] }>('vault-sync-request');
    const serverManifest = res.manifest;
    const serverByPath = new Map(serverManifest.map((e) => [e.path, e]));

    // Local files (allowed only)
    const localFiles = this.vault.getFiles().filter((f) => isAllowed(f.path));
    const localByPath = new Map(localFiles.map((f) => [f.path, f]));

    const toCreate: string[] = [];
    const toUpdate: string[] = [];
    const toDelete: TFile[] = [];
    const toQuarantine: TFile[] = [];

    // Files on server — pull if missing or hash differs
    for (const entry of serverManifest) {
      const local = localByPath.get(entry.path);
      if (!local) {
        toCreate.push(entry.path);
        continue;
      }
      // Compare by hash (mtime not reliable across machines)
      const localContent = await this.vault.read(local);
      const localHash = hashContent(localContent);
      if (localHash !== entry.hash) {
        toUpdate.push(entry.path);
      } else {
        // Same — just cache it
        this.fileCache.set(entry.path, localContent);
      }
    }

    // Files local but not on server
    for (const file of localFiles) {
      if (!serverByPath.has(file.path)) {
        if (this.localMissingStrategy === 'delete') {
          toDelete.push(file);
        } else if (this.localMissingStrategy === 'quarantine') {
          toQuarantine.push(file);
        }
      }
    }

    // Execute deletions
    for (const file of toDelete) {
      await this.deleteLocal(file.path);
    }

    let quarantineRoot: string | null = null;
    if (toQuarantine.length > 0) {
      quarantineRoot = `.hive-quarantine/${new Date().toISOString().replace(/[:.]/g, '-')}`;
      for (const file of toQuarantine) {
        await this.quarantineLocal(file, quarantineRoot);
      }
    }

    // Execute pulls (new files)
    for (const relPath of toCreate) {
      await this.pullFile(relPath);
    }

    // Execute pulls (updated files)
    for (const relPath of toUpdate) {
      await this.pullFile(relPath);
    }

    const created = toCreate.length;
    const updated = toUpdate.length;
    const deleted = toDelete.length;
    const quarantined = toQuarantine.length;
    console.log(
      `[sync] Synced: ${created} created, ${updated} updated, ${deleted} deleted, ${quarantined} quarantined`
    );
    return { updated, created, deleted, quarantined, quarantinePath: quarantineRoot };
  }

  // ---------------------------------------------------------------------------
  // Individual file operations
  // ---------------------------------------------------------------------------

  private async ensureParentFolders(relPath: string): Promise<void> {
    const parts = relPath.split('/');
    if (parts.length < 2) return;

    let current = '';
    for (const segment of parts.slice(0, -1)) {
      current = current ? `${current}/${segment}` : segment;
      if (this.vault.getAbstractFileByPath(current)) continue;
      try {
        await this.vault.createFolder(current);
      } catch {
        if (!this.vault.getAbstractFileByPath(current)) {
          throw new Error(`Failed creating folder: ${current}`);
        }
      }
    }
  }

  private async quarantineLocal(file: TFile, rootPath: string): Promise<void> {
    const targetPath = `${rootPath}/${file.path}`;
    await this.ensureParentFolders(targetPath);

    suppress(file.path);
    suppress(targetPath);
    try {
      await this.vault.rename(file, targetPath);
    } finally {
      unsuppress(file.path);
      unsuppress(targetPath);
    }
    this.fileCache.delete(file.path);
  }

  async pullFile(relPath: string): Promise<void> {
    try {
      const res = await this.socket.request<{ content: string; hash: string }>('file-read', relPath);
      const { content } = res;

      suppress(relPath);
      try {
        const existing = this.vault.getFileByPath(relPath);
        if (existing) {
          await this.vault.modify(existing, content);
        } else {
          await this.ensureParentFolders(relPath);
          await this.vault.create(relPath, content);
        }
      } finally {
        unsuppress(relPath);
      }

      this.fileCache.set(relPath, content);
    } catch (err) {
      console.error(`[sync] pullFile error (${relPath}):`, err);
    }
  }

  async deleteLocal(relPath: string): Promise<void> {
    const file = this.vault.getFileByPath(relPath);
    if (!file) return;
    suppress(relPath);
    try {
      await this.vault.delete(file);
    } finally {
      unsuppress(relPath);
    }
    this.fileCache.delete(relPath);
  }
}
