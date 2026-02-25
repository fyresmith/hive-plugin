import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import { ActiveEditorEntry } from '../presenceManager';

export const HIVE_ACTIVE_EDITORS_VIEW = 'hive-active-editors';

interface ActiveEditorsViewOptions {
  getCurrentFilePath: () => string | null;
  getCurrentFileEditors: (filePath: string) => ActiveEditorEntry[];
  getWorkspaceEditors: () => ActiveEditorEntry[];
  onJumpToCollaborator: (userId: string) => void;
  onFollowCollaborator: (userId: string, mode: 'cursor' | 'viewport') => void;
}

export class ActiveEditorsView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private options: ActiveEditorsViewOptions) {
    super(leaf);
  }

  getViewType(): string {
    return HIVE_ACTIVE_EDITORS_VIEW;
  }

  getDisplayText(): string {
    return 'Hive Active Editors';
  }

  getIcon(): string {
    return 'users';
  }

  async onOpen(): Promise<void> {
    this.containerEl.addClass('hive-panel-view');
    this.render();
  }

  async onClose(): Promise<void> {
    this.containerEl.empty();
  }

  refresh(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    const root = contentEl.createDiv({ cls: 'hive-panel-root hive-active-editors-root' });
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Hive active editors');

    const header = root.createDiv({ cls: 'hive-panel-header' });
    const icon = header.createSpan({ cls: 'hive-panel-header-icon' });
    setIcon(icon, 'users');
    header.createEl('h3', { text: 'Active Editors' });

    const currentFile = this.options.getCurrentFilePath();

    const currentSection = root.createDiv({ cls: 'hive-panel-section' });
    currentSection.createEl('h4', { text: currentFile ? `Current file: ${currentFile}` : 'Current file' });
    if (currentFile) {
      this.renderUserList(currentSection, this.options.getCurrentFileEditors(currentFile));
    } else {
      currentSection.createDiv({ cls: 'hive-panel-empty', text: 'Open a file to see active collaborators.' });
    }

    const workspaceSection = root.createDiv({ cls: 'hive-panel-section' });
    workspaceSection.createEl('h4', { text: 'Workspace collaborators' });
    this.renderUserList(workspaceSection, this.options.getWorkspaceEditors());
  }

  private renderUserList(parent: HTMLElement, users: ActiveEditorEntry[]): void {
    if (users.length === 0) {
      parent.createDiv({ cls: 'hive-panel-empty', text: 'No active collaborators.' });
      return;
    }

    const list = parent.createDiv({ cls: 'hive-active-editors-list' });
    list.setAttribute('role', 'list');

    for (const user of users) {
      const item = list.createDiv({ cls: 'hive-active-editor-item' });
      item.setAttribute('role', 'listitem');

      const identity = item.createDiv({ cls: 'hive-active-editor-identity' });
      const avatar = identity.createEl('img', { cls: 'hive-active-editor-avatar' });
      avatar.src = user.avatarUrl;
      avatar.alt = user.username;
      avatar.style.borderColor = user.color;

      const meta = identity.createDiv({ cls: 'hive-active-editor-meta' });
      meta.createDiv({ cls: 'hive-active-editor-name', text: user.username });
      meta.createDiv({
        cls: 'hive-active-editor-path',
        text: user.activeFile ?? (user.openFiles[0] ?? 'No active file'),
      });

      const actions = item.createDiv({ cls: 'hive-active-editor-actions' });

      const jumpBtn = actions.createEl('button', { text: 'Jump' });
      jumpBtn.type = 'button';
      jumpBtn.setAttribute('aria-label', `Jump to ${user.username}`);
      jumpBtn.addEventListener('click', () => this.options.onJumpToCollaborator(user.userId));

      const followBtn = actions.createEl('button', { text: 'Follow' });
      followBtn.type = 'button';
      followBtn.setAttribute('aria-label', `Follow ${user.username}`);
      followBtn.addEventListener('click', () => this.options.onFollowCollaborator(user.userId, 'cursor'));

      if (user.stale) {
        item.addClass('is-stale');
      }
    }
  }
}
