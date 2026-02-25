import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import { CollabThread } from '../collab/collabClient';

export const HIVE_THREADS_VIEW = 'hive-collab-threads';

interface CollabThreadsViewOptions {
  getCurrentFilePath: () => string | null;
  listThreads: (filePath: string | null) => Promise<CollabThread[]>;
  createThread: (filePath: string, body: string) => Promise<void>;
  setTaskState: (threadId: string, status: 'open' | 'resolved') => Promise<void>;
}

export class CollabThreadsView extends ItemView {
  private threads: CollabThread[] = [];
  private loading = false;
  private error: string | null = null;

  constructor(leaf: WorkspaceLeaf, private options: CollabThreadsViewOptions) {
    super(leaf);
  }

  getViewType(): string {
    return HIVE_THREADS_VIEW;
  }

  getDisplayText(): string {
    return 'Hive Threads';
  }

  getIcon(): string {
    return 'messages-square';
  }

  async onOpen(): Promise<void> {
    this.containerEl.addClass('hive-panel-view');
    await this.reload();
  }

  async onClose(): Promise<void> {
    this.containerEl.empty();
  }

  async reload(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      this.threads = await this.options.listThreads(this.options.getCurrentFilePath());
    } catch (err) {
      this.error = (err as Error).message;
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    const root = contentEl.createDiv({ cls: 'hive-panel-root hive-threads-root' });
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Hive comment threads');

    const header = root.createDiv({ cls: 'hive-panel-header' });
    const icon = header.createSpan({ cls: 'hive-panel-header-icon' });
    setIcon(icon, 'messages-square');
    header.createEl('h3', { text: 'Comment Threads' });

    const actions = root.createDiv({ cls: 'hive-thread-actions' });
    const newThreadBtn = actions.createEl('button', { text: 'New Thread' });
    newThreadBtn.type = 'button';
    newThreadBtn.addEventListener('click', async () => {
      const filePath = this.options.getCurrentFilePath();
      if (!filePath) {
        new Notice('Hive: Open a file before creating a thread.');
        return;
      }

      const body = window.prompt('Create thread comment');
      if (!body || body.trim().length === 0) return;
      await this.options.createThread(filePath, body.trim());
      await this.reload();
    });

    if (this.loading) {
      root.createDiv({ cls: 'hive-panel-empty', text: 'Loading threads…' });
      return;
    }

    if (this.error) {
      root.createDiv({ cls: 'hive-panel-error', text: this.error });
      return;
    }

    if (this.threads.length === 0) {
      root.createDiv({ cls: 'hive-panel-empty', text: 'No threads for this scope.' });
      return;
    }

    const list = root.createDiv({ cls: 'hive-thread-list' });
    list.setAttribute('role', 'list');

    for (const thread of this.threads) {
      const item = list.createDiv({ cls: 'hive-thread-item' });
      item.setAttribute('role', 'listitem');

      const firstComment = thread.comments[0]?.body ?? '(no comments)';
      item.createDiv({
        cls: 'hive-thread-title',
        text: `${thread.filePath} · ${thread.status}`,
      });
      item.createDiv({
        cls: 'hive-thread-body',
        text: firstComment.length > 180 ? `${firstComment.slice(0, 180)}…` : firstComment,
      });

      const taskBtn = item.createEl('button', {
        text: thread.task?.status === 'resolved' ? 'Reopen task' : 'Resolve task',
      });
      taskBtn.type = 'button';
      taskBtn.addEventListener('click', async () => {
        await this.options.setTaskState(
          thread.threadId,
          thread.task?.status === 'resolved' ? 'open' : 'resolved',
        );
        await this.reload();
      });
    }
  }
}
