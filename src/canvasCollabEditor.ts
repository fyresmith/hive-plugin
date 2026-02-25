import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { TFile, Vault } from 'obsidian';
import { isSuppressed, suppress, unsuppress } from './suppressedPaths';

export class CanvasCollabEditor {
  private ydoc: Y.Doc | null = null;
  private provider: WebsocketProvider | null = null;
  private yText: Y.Text | null = null;
  private destroyed = false;
  private views = new Set<string>();
  private applyQueue: Promise<void> = Promise.resolve();
  private onModifyRef: (file: TFile) => void;

  constructor(
    private serverUrl: string,
    private filePath: string,
    private token: string,
    private vault: Vault,
  ) {
    this.onModifyRef = (file) => {
      void this.handleLocalModify(file);
    };
  }

  attach(): void {
    if (this.destroyed) return;

    const wsUrl = this.serverUrl
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://')
      + '/yjs';

    const roomName = encodeURIComponent(this.filePath);
    this.ydoc = new Y.Doc();
    this.provider = new WebsocketProvider(wsUrl, roomName, this.ydoc, {
      params: { token: this.token },
    });
    this.yText = this.ydoc.getText('content');

    this.yText.observe(() => {
      this.enqueueApplyFromYjs();
    });

    this.provider.on('sync', (isSynced: boolean) => {
      if (!isSynced) return;
      this.enqueueApplyFromYjs();
    });

    this.vault.on('modify', this.onModifyRef);
  }

  attachView(bindingKey: string, _view: unknown): void {
    this.views.add(bindingKey);
  }

  detachView(bindingKey: string): void {
    this.views.delete(bindingKey);
  }

  isEmpty(): boolean {
    return this.views.size === 0;
  }

  updateLocalCursorPreferences(_color: string | null, _useProfileForCursor: boolean): void {
    // Canvas live sync currently has no cursor personalization overlays.
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.vault.off('modify', this.onModifyRef);
    this.provider?.destroy();
    this.ydoc?.destroy();
    this.provider = null;
    this.ydoc = null;
    this.yText = null;
    this.views.clear();
  }

  private enqueueApplyFromYjs(): void {
    this.applyQueue = this.applyQueue
      .then(() => this.applyFromYjs())
      .catch((err) => {
        console.error(`[canvas-collab] apply error (${this.filePath}):`, err);
      });
  }

  private async applyFromYjs(): Promise<void> {
    if (this.destroyed || !this.yText) return;
    const content = this.yText.toString();

    const existing = this.vault.getFileByPath(this.filePath);
    if (existing) {
      const current = await this.vault.read(existing);
      if (current === content) return;
      suppress(this.filePath);
      try {
        await this.vault.modify(existing, content);
      } finally {
        unsuppress(this.filePath);
      }
      return;
    }

    await this.ensureParentFolders(this.filePath);
    suppress(this.filePath);
    try {
      await this.vault.create(this.filePath, content);
    } finally {
      unsuppress(this.filePath);
    }
  }

  private async handleLocalModify(file: TFile): Promise<void> {
    if (this.destroyed) return;
    if (file.path !== this.filePath) return;
    if (isSuppressed(this.filePath)) return;
    if (!this.yText || !this.ydoc) return;

    const content = await this.vault.read(file);
    const yContent = this.yText.toString();
    if (content === yContent) return;

    this.ydoc.transact(() => {
      this.yText!.delete(0, yContent.length);
      this.yText!.insert(0, content);
    });
  }

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
}
