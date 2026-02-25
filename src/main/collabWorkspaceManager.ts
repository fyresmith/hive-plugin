import { App, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import { CollabEditor } from '../collabEditor';
import { CanvasCollabEditor } from '../canvasCollabEditor';
import { DiscordUser } from '../types';

interface CollabBinding {
  key: string;
  path: string;
  kind: 'markdown' | 'canvas';
  leaf: WorkspaceLeaf;
  view: unknown;
}

interface CollabSessionConfig {
  serverUrl: string;
  token: string | null;
  user: DiscordUser | null;
  cursorColor: string | null;
  useProfileForCursor: boolean;
}

interface CollabWorkspaceManagerOptions {
  app: App;
  isSocketConnected: () => boolean;
  getSessionConfig: () => CollabSessionConfig;
  onPresenceFileOpened: (path: string) => void;
  onPresenceFileClosed: (path: string) => void;
}

export class CollabWorkspaceManager {
  private collabBindings = new Map<string, CollabBinding>();
  private collabRooms = new Map<string, CollabEditor | CanvasCollabEditor>();
  private leafKeys = new WeakMap<WorkspaceLeaf, string>();
  private nextLeafKey = 1;
  private syncingOpenLeaves = false;
  private syncLeavesAgain = false;

  constructor(private options: CollabWorkspaceManagerOptions) {}

  hasCollabPath(path: string): boolean {
    return this.collabRooms.has(path);
  }

  getCollabPaths(): Set<string> {
    return new Set(this.collabRooms.keys());
  }

  updateLocalCursorPreferences(cursorColor: string | null, useProfileForCursor: boolean): void {
    for (const [, room] of this.collabRooms) {
      room.updateLocalCursorPreferences(cursorColor, useProfileForCursor);
    }
  }

  async handleActiveLeafChange(leaf: WorkspaceLeaf | null): Promise<void> {
    if (!this.options.isSocketConnected()) return;
    if (!leaf) return;

    const target = this.getCollabTargetForLeaf(leaf);
    if (!target) {
      this.scheduleOpenLeavesSync();
      return;
    }

    await this.attachCollabEditor(leaf, target.view, target.file, target.kind);
    this.scheduleOpenLeavesSync();
  }

  handleLayoutChange(): void {
    if (!this.options.isSocketConnected()) return;
    this.scheduleOpenLeavesSync();
  }

  async syncOpenLeavesNow(): Promise<void> {
    if (!this.options.isSocketConnected()) return;

    const openLeaves = this.getOpenCollabLeaves();
    const activeKeys = new Set<string>();

    for (const { leaf, view, file, kind } of openLeaves) {
      const key = this.makeBindingKey(leaf, file.path);
      activeKeys.add(key);
      if (!this.collabBindings.has(key)) {
        await this.attachCollabEditor(leaf, view, file, kind);
      }
    }

    const existingKeys = [...this.collabBindings.keys()];
    for (const key of existingKeys) {
      if (!activeKeys.has(key)) {
        this.destroyCollabEditor(key);
      }
    }
  }

  scheduleOpenLeavesSync(): void {
    if (this.syncingOpenLeaves) {
      this.syncLeavesAgain = true;
      return;
    }

    this.syncingOpenLeaves = true;
    void this.syncOpenLeavesNow().finally(() => {
      this.syncingOpenLeaves = false;
      if (this.syncLeavesAgain) {
        this.syncLeavesAgain = false;
        this.scheduleOpenLeavesSync();
      }
    });
  }

  destroyCollabEditorsForPath(path: string): void {
    const keys = [...this.collabBindings.values()]
      .filter((binding) => binding.path === path)
      .map((binding) => binding.key);

    if (keys.length === 0) {
      const room = this.collabRooms.get(path);
      if (!room) return;
      room.destroy();
      this.collabRooms.delete(path);
      if (this.options.isSocketConnected()) {
        this.options.onPresenceFileClosed(path);
      }
      return;
    }

    for (const key of keys) {
      this.destroyCollabEditor(key);
    }

    const room = this.collabRooms.get(path);
    if (room) {
      room.destroy();
      this.collabRooms.delete(path);
    }
  }

  destroyAllCollabEditors(): void {
    for (const [key] of this.collabBindings) {
      this.destroyCollabEditor(key);
    }
    for (const [, room] of this.collabRooms) {
      room.destroy();
    }
    this.collabBindings.clear();
    this.collabRooms.clear();
  }

  resetSyncState(): void {
    this.syncingOpenLeaves = false;
    this.syncLeavesAgain = false;
  }

  private getLeafKey(leaf: WorkspaceLeaf): string {
    let key = this.leafKeys.get(leaf);
    if (!key) {
      key = `leaf-${this.nextLeafKey++}`;
      this.leafKeys.set(leaf, key);
    }
    return key;
  }

  private makeBindingKey(leaf: WorkspaceLeaf, path: string): string {
    return `${this.getLeafKey(leaf)}::${path}`;
  }

  private isSourceMode(view: MarkdownView): boolean {
    const mode = (view as any).getMode?.();
    if (typeof mode !== 'string') return true;
    return mode !== 'preview';
  }

  private getCollabTargetForLeaf(leaf: WorkspaceLeaf): {
    kind: 'markdown' | 'canvas';
    view: unknown;
    file: TFile;
  } | null {
    const view = leaf.view;

    if (view instanceof MarkdownView) {
      if (!this.isSourceMode(view)) return null;
      const file = view.file;
      if (!file || !file.path.endsWith('.md')) return null;
      return { kind: 'markdown', view, file };
    }

    const viewType = (view as any)?.getViewType?.();
    const file = (view as any)?.file as TFile | null | undefined;
    if (viewType === 'canvas' && file && file.path.endsWith('.canvas')) {
      return { kind: 'canvas', view, file };
    }

    return null;
  }

  private getOpenCollabLeaves(): Array<{
    leaf: WorkspaceLeaf;
    view: unknown;
    file: TFile;
    kind: 'markdown' | 'canvas';
  }> {
    const leaves: Array<{ leaf: WorkspaceLeaf; view: unknown; file: TFile; kind: 'markdown' | 'canvas' }> = [];
    this.options.app.workspace.iterateAllLeaves((leaf) => {
      const target = this.getCollabTargetForLeaf(leaf);
      if (!target) return;
      leaves.push({ leaf, view: target.view, file: target.file, kind: target.kind });
    });
    return leaves;
  }

  private async attachCollabEditor(
    leaf: WorkspaceLeaf,
    view: unknown,
    file: TFile,
    kind: 'markdown' | 'canvas',
  ): Promise<void> {
    const config = this.options.getSessionConfig();
    if (!config.token || !config.user) return;

    const key = this.makeBindingKey(leaf, file.path);
    if (this.collabBindings.has(key)) return;
    const hadPathBinding = this.hasCollabPath(file.path);

    let room = this.collabRooms.get(file.path);
    if (!room) {
      if (kind === 'markdown') {
        room = new CollabEditor(
          config.serverUrl,
          file.path,
          config.user,
          config.token,
          config.cursorColor,
          config.useProfileForCursor,
        );
      } else {
        room = new CanvasCollabEditor(
          config.serverUrl,
          file.path,
          config.token,
          this.options.app.vault,
        );
      }
      room.attach();
      this.collabRooms.set(file.path, room);
    }

    room.attachView(key, view);
    this.collabBindings.set(key, { key, path: file.path, kind, leaf, view });

    if (!hadPathBinding && this.options.isSocketConnected()) {
      this.options.onPresenceFileOpened(file.path);
    }
  }

  private destroyCollabEditor(key: string): void {
    const binding = this.collabBindings.get(key);
    if (!binding) return;

    const path = binding.path;
    const room = this.collabRooms.get(path);
    room?.detachView(key);
    this.collabBindings.delete(key);

    if (room?.isEmpty()) {
      room.destroy();
      this.collabRooms.delete(path);
    }

    if (this.options.isSocketConnected() && !this.hasCollabPath(path)) {
      this.options.onPresenceFileClosed(path);
    }
  }
}
