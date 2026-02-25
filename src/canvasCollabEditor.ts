import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { TFile, Vault } from 'obsidian';
import { isSuppressed, suppress, unsuppress } from './suppressedPaths';
import {
  CanvasModel,
  parseCanvasModel,
  canonicalizeCanvasModel,
  serializeCanvasModel,
  mergeCanvasModels,
} from './collab/canvasModel';

function isYArray(value: unknown): value is Y.Array<any> {
  return value instanceof Y.Array;
}

export class CanvasCollabEditor {
  private ydoc: Y.Doc | null = null;
  private provider: WebsocketProvider | null = null;
  private legacyText: Y.Text | null = null;
  private canvasMap: Y.Map<any> | null = null;
  private destroyed = false;
  private views = new Set<string>();
  private applyQueue: Promise<void> = Promise.resolve();
  private onModifyRef: (file: TFile) => void;
  private syncingFromShared = false;
  private syncingToShared = false;

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

    this.legacyText = this.ydoc.getText('content');
    this.canvasMap = this.ydoc.getMap('canvas');

    this.legacyText.observe(() => {
      if (this.syncingToShared) return;
      this.enqueueApplyFromYjs();
    });

    this.canvasMap.observeDeep(() => {
      if (this.syncingToShared) return;
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
    // Canvas adapter currently synchronizes document model, not cursor decorations.
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.vault.off('modify', this.onModifyRef);
    this.provider?.destroy();
    this.ydoc?.destroy();
    this.provider = null;
    this.ydoc = null;
    this.legacyText = null;
    this.canvasMap = null;
    this.views.clear();
  }

  private enqueueApplyFromYjs(): void {
    this.applyQueue = this.applyQueue
      .then(() => this.applyFromYjs())
      .catch((err) => {
        console.error(`[canvas-collab] apply error (${this.filePath}):`, err);
      });
  }

  private readStructuredModel(): CanvasModel | null {
    if (!this.canvasMap) return null;

    const nodes = this.canvasMap.get('nodes');
    const edges = this.canvasMap.get('edges');
    if (!isYArray(nodes) || !isYArray(edges)) {
      return null;
    }

    return canonicalizeCanvasModel({
      nodes: nodes.toArray(),
      edges: edges.toArray(),
    });
  }

  private readLegacyModel(): CanvasModel {
    if (!this.legacyText) {
      return canonicalizeCanvasModel({ nodes: [], edges: [] });
    }
    return parseCanvasModel(this.legacyText.toString());
  }

  private writeStructuredModel(model: CanvasModel): void {
    if (!this.canvasMap || !this.ydoc) return;

    const canonical = canonicalizeCanvasModel(model);
    this.syncingToShared = true;
    try {
      this.ydoc.transact(() => {
        const nodes = new Y.Array<any>();
        const edges = new Y.Array<any>();
        nodes.push(canonical.nodes as any[]);
        edges.push(canonical.edges as any[]);
        this.canvasMap!.set('schemaVersion', 2);
        this.canvasMap!.set('nodes', nodes);
        this.canvasMap!.set('edges', edges);
      });
    } finally {
      this.syncingToShared = false;
    }
  }

  private writeLegacyModel(model: CanvasModel): void {
    if (!this.legacyText || !this.ydoc) return;

    const serialized = serializeCanvasModel(model);
    const current = this.legacyText.toString();
    if (serialized === current) return;

    this.syncingToShared = true;
    try {
      this.ydoc.transact(() => {
        this.legacyText!.delete(0, current.length);
        this.legacyText!.insert(0, serialized);
      });
    } finally {
      this.syncingToShared = false;
    }
  }

  private resolveSharedModel(): CanvasModel {
    const structured = this.readStructuredModel();
    const legacy = this.readLegacyModel();

    if (!structured) {
      this.writeStructuredModel(legacy);
      return legacy;
    }

    const merged = mergeCanvasModels(structured, legacy);
    this.writeLegacyModel(merged);
    this.writeStructuredModel(merged);
    return merged;
  }

  private async applyFromYjs(): Promise<void> {
    if (this.destroyed || this.syncingFromShared) return;

    const model = this.resolveSharedModel();
    const content = serializeCanvasModel(model);

    const existing = this.vault.getFileByPath(this.filePath);
    this.syncingFromShared = true;
    try {
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
    } finally {
      this.syncingFromShared = false;
    }
  }

  private async handleLocalModify(file: TFile): Promise<void> {
    if (this.destroyed) return;
    if (file.path !== this.filePath) return;
    if (isSuppressed(this.filePath)) return;
    if (!this.legacyText || !this.ydoc || !this.canvasMap) return;

    const content = await this.vault.read(file);
    const localModel = parseCanvasModel(content);
    const sharedModel = this.resolveSharedModel();
    const merged = mergeCanvasModels(sharedModel, localModel);

    this.writeStructuredModel(merged);
    this.writeLegacyModel(merged);
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
