import { App, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import { CollabEditor } from '../collabEditor';
import { DiscordUser } from '../types';

interface CollabBinding {
  key: string;
  path: string;
  leaf: WorkspaceLeaf;
  view: MarkdownView;
}

interface CollabSessionConfig {
  serverUrl: string;
  vaultId: string;
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
  private collabRooms = new Map<string, CollabEditor>();
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

    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    if (!this.isSourceMode(view)) {
      this.scheduleOpenLeavesSync();
      return;
    }

    const file = view.file;
    if (!file || !file.path.endsWith('.md')) return;

    await this.attachCollabEditor(leaf, view, file);
    this.scheduleOpenLeavesSync();
  }

  handleLayoutChange(): void {
    if (!this.options.isSocketConnected()) return;
    this.scheduleOpenLeavesSync();
  }

  async syncOpenLeavesNow(): Promise<void> {
    if (!this.options.isSocketConnected()) return;

    const openLeaves = this.getOpenMarkdownLeaves();
    const activeKeys = new Set<string>();

    for (const { leaf, view, file } of openLeaves) {
      const key = this.makeBindingKey(leaf, file.path);
      activeKeys.add(key);
      if (!this.collabBindings.has(key)) {
        await this.attachCollabEditor(leaf, view, file);
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

  private getOpenMarkdownLeaves(): Array<{ leaf: WorkspaceLeaf; view: MarkdownView; file: TFile }> {
    const leaves: Array<{ leaf: WorkspaceLeaf; view: MarkdownView; file: TFile }> = [];
    this.options.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) return;
      if (!this.isSourceMode(view)) return;
      const file = view.file;
      if (!file || !file.path.endsWith('.md')) return;
      leaves.push({ leaf, view, file });
    });
    return leaves;
  }

  private async attachCollabEditor(
    leaf: WorkspaceLeaf,
    view: MarkdownView,
    file: TFile,
  ): Promise<void> {
    const config = this.options.getSessionConfig();
    if (!config.token || !config.user) return;

    const key = this.makeBindingKey(leaf, file.path);
    if (this.collabBindings.has(key)) return;
    const hadPathBinding = this.hasCollabPath(file.path);

    let room = this.collabRooms.get(file.path);
    if (!room) {
      room = new CollabEditor(
        config.serverUrl,
        config.vaultId,
        file.path,
        config.user,
        config.token,
        config.cursorColor,
        config.useProfileForCursor,
      );
      room.attach();
      this.collabRooms.set(file.path, room);
    }

    room.attachView(key, view);
    this.collabBindings.set(key, { key, path: file.path, leaf, view });

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
