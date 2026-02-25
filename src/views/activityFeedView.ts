import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import { ActivityType, GroupedActivity } from '../collab/activityFeedStore';

export const HIVE_ACTIVITY_FEED_VIEW = 'hive-activity-feed';

interface ActivityFeedViewOptions {
  getCurrentFilePath: () => string | null;
  getGroupedActivity: (scope: 'workspace' | 'file', filePath: string | null, types: Set<ActivityType>) => GroupedActivity[];
  onScopeChange: (scope: 'workspace' | 'file', filePath: string | null) => void;
}

const FILTERS: ActivityType[] = ['edit', 'comment', 'task', 'create', 'delete', 'rename', 'restore', 'presence', 'external'];

export class ActivityFeedView extends ItemView {
  private scope: 'workspace' | 'file' = 'workspace';
  private activeTypes = new Set<ActivityType>();

  constructor(leaf: WorkspaceLeaf, private options: ActivityFeedViewOptions) {
    super(leaf);
  }

  getViewType(): string {
    return HIVE_ACTIVITY_FEED_VIEW;
  }

  getDisplayText(): string {
    return 'Hive Activity Feed';
  }

  getIcon(): string {
    return 'history';
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

    const root = contentEl.createDiv({ cls: 'hive-panel-root hive-activity-feed-root' });
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Hive activity feed');

    const header = root.createDiv({ cls: 'hive-panel-header' });
    const icon = header.createSpan({ cls: 'hive-panel-header-icon' });
    setIcon(icon, 'history');
    header.createEl('h3', { text: 'Activity Feed' });

    const controls = root.createDiv({ cls: 'hive-activity-controls' });

    const scopeSelect = controls.createEl('select');
    scopeSelect.setAttribute('aria-label', 'Activity scope');
    scopeSelect.add(new Option('Workspace', 'workspace'));
    scopeSelect.add(new Option('Current file', 'file'));
    scopeSelect.value = this.scope;
    scopeSelect.addEventListener('change', () => {
      this.scope = scopeSelect.value === 'file' ? 'file' : 'workspace';
      this.options.onScopeChange(this.scope, this.options.getCurrentFilePath());
      this.render();
    });

    const filterWrap = controls.createDiv({ cls: 'hive-activity-filters' });
    for (const filter of FILTERS) {
      const btn = filterWrap.createEl('button', { text: filter });
      btn.type = 'button';
      btn.addClass('hive-filter-btn');
      if (this.activeTypes.has(filter)) {
        btn.addClass('is-active');
      }
      btn.addEventListener('click', () => {
        if (this.activeTypes.has(filter)) {
          this.activeTypes.delete(filter);
        } else {
          this.activeTypes.add(filter);
        }
        this.render();
      });
    }

    const filePath = this.scope === 'file' ? this.options.getCurrentFilePath() : null;
    const groups = this.options.getGroupedActivity(this.scope, filePath, this.activeTypes);

    const list = root.createDiv({ cls: 'hive-activity-list' });
    list.setAttribute('role', 'list');

    if (groups.length === 0) {
      list.createDiv({ cls: 'hive-panel-empty', text: 'No activity yet for this scope/filter.' });
      return;
    }

    for (const group of groups) {
      const item = list.createDiv({ cls: 'hive-activity-item' });
      item.setAttribute('role', 'listitem');

      const actor = group.actor?.username ? `@${group.actor.username}` : 'system';
      item.createDiv({
        cls: 'hive-activity-title',
        text: `${actor} · ${group.type} · ${group.count} event${group.count === 1 ? '' : 's'}`,
      });
      item.createDiv({
        cls: 'hive-activity-meta',
        text: `${group.filePath ?? 'workspace'} · ${new Date(group.startedAt).toLocaleString()}`,
      });
    }
  }
}
