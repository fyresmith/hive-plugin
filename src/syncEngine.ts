import { createHash } from 'crypto';
import { TFile, Vault, Notice } from 'obsidian';
import { SocketClient } from './socket';
import { ManifestEntry } from './types';
import { suppress, unsuppress } from './suppressedPaths';
import { isMetadataAllowedPath } from './collab/adapters/metadataPolicy';

const ALLOW_EXTS = new Set(['.md', '.canvas']);
const DENY_PREFIXES = ['.obsidian/', '.hive-history/', 'Attachments/', '.git/'];

export function isAllowed(path: string): boolean {
  if (isMetadataAllowedPath(path)) return true;

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

export class SyncEngine {
  /** Last known content for each file — used for offline reverts. */
  fileCache = new Map<string, string>();
  /** Last known server hash per file — used for optimistic concurrency checks. */
  fileHashCache = new Map<string, string>();

  constructor(
    private socket: SocketClient,
    private vault: Vault,
  ) {}

  // ---------------------------------------------------------------------------
  // Initial sync
  // ---------------------------------------------------------------------------

  async initialSync(): Promise<void> {
    console.log('[sync] Starting initial sync...');

    const res = await this.socket.request<{ manifest: ManifestEntry[] }>('vault-sync-request');
    const serverManifest = res.manifest;
    const serverByPath = new Map(serverManifest.map((e) => [e.path, e]));

    // Local files (allowed only)
    const localFiles = this.vault.getFiles().filter((f) => isAllowed(f.path));
    const localByPath = new Map(localFiles.map((f) => [f.path, f]));

    const toPull: string[] = [];
    const toDelete: TFile[] = [];

    // Files on server — pull if missing or hash differs
    for (const entry of serverManifest) {
      const local = localByPath.get(entry.path);
      if (!local) {
        toPull.push(entry.path);
        continue;
      }
      // Compare by hash (mtime not reliable across machines)
      const localContent = await this.vault.read(local);
      const localHash = hashContent(localContent);
      if (localHash !== entry.hash) {
        toPull.push(entry.path);
      } else {
        // Same — just cache it
        this.recordKnownState(entry.path, localContent, entry.hash);
      }
    }

    // Files local but not on server — delete locally
    for (const file of localFiles) {
      if (!serverByPath.has(file.path)) {
        toDelete.push(file);
      }
    }

    // Execute deletions
    for (const file of toDelete) {
      await this.deleteLocal(file.path);
    }

    // Execute pulls
    for (const relPath of toPull) {
      await this.pullFile(relPath);
    }

    const msg = `Hive: Synced (${toPull.length} pulled, ${toDelete.length} deleted)`;
    new Notice(msg);
    console.log(`[sync] ${msg}`);
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

  async pullFile(relPath: string): Promise<void> {
    try {
      const res = await this.socket.request<{ content: string; hash: string }>('file-read', relPath);
      const { content, hash } = res;

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

      this.recordKnownState(relPath, content, hash);
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
    this.clearKnownState(relPath);
  }

  getKnownHash(relPath: string): string | null {
    return this.fileHashCache.get(relPath) ?? null;
  }

  recordKnownState(relPath: string, content: string, hash: string): void {
    this.fileCache.set(relPath, content);
    this.fileHashCache.set(relPath, hash);
  }

  clearKnownState(relPath: string): void {
    this.fileCache.delete(relPath);
    this.fileHashCache.delete(relPath);
  }
}
