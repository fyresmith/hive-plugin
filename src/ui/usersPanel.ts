import { ItemView, WorkspaceLeaf } from 'obsidian';
import type HivePlugin from '../main';

export const HIVE_USERS_VIEW = 'hive-users-panel';

export class HiveUsersPanel extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: HivePlugin) {
    super(leaf);
  }

  getViewType(): string {
    return HIVE_USERS_VIEW;
  }

  getDisplayText(): string {
    return 'Hive — Users';
  }

  getIcon(): string {
    return 'users';
  }

  async onOpen(): Promise<void> {
    if (this.plugin.presenceManager) {
      this.plugin.presenceManager.onChanged = () => {
        this.render();
        this.plugin.refreshStatusCount();
      };
    }
    this.render();
  }

  async onClose(): Promise<void> {
    if (this.plugin.presenceManager) {
      this.plugin.presenceManager.onChanged = undefined;
    }
  }

  render(): void {
    const content = this.containerEl.children[1] as HTMLElement;
    content.empty();
    content.addClass('hive-users-panel');

    const pm = this.plugin.presenceManager;
    const settings = this.plugin.settings;

    // ── Self section ──────────────────────────────────────────────────────────
    const selfSection = content.createDiv({ cls: 'hive-panel-self-section' });
    const selfItem = selfSection.createDiv({ cls: 'hive-panel-user-item' });

    if (settings.user?.avatarUrl) {
      const avatar = selfItem.createEl('img', { cls: 'hive-panel-user-avatar' });
      avatar.src = settings.user.avatarUrl;
    }

    const selfMeta = selfItem.createDiv({ cls: 'hive-panel-user-meta' });
    selfMeta.createDiv({
      cls: 'hive-panel-user-name',
      text: settings.user ? `@${settings.user.username}` : 'You',
    });

    const statusInput = selfMeta.createEl('input', { cls: 'hive-panel-status-input' });
    statusInput.type = 'text';
    statusInput.placeholder = 'Set a status…';
    statusInput.maxLength = 30;
    statusInput.value = settings.statusMessage ?? '';

    statusInput.addEventListener('blur', () => {
      const newStatus = statusInput.value.trim().slice(0, 30);
      this.plugin.settings.statusMessage = newStatus;
      void this.plugin.saveSettings();
      this.plugin.emitUserStatus(newStatus);
    });
    statusInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') statusInput.blur();
    });

    // ── Online count ──────────────────────────────────────────────────────────
    if (!pm) {
      content.createDiv({ cls: 'hive-panel-online-count', text: 'Not connected.' });
      return;
    }

    const count = pm.getRemoteUserCount();
    content.createDiv({
      cls: 'hive-panel-online-count',
      text: `${count} online`,
    });

    // ── Remote users ──────────────────────────────────────────────────────────
    for (const [userId, user] of pm.getRemoteUsers()) {
      const item = content.createDiv({ cls: 'hive-panel-user-item' });

      const avatar = item.createEl('img', { cls: 'hive-panel-user-avatar' });
      avatar.src = user.avatarUrl;
      (avatar as HTMLImageElement).style.borderColor = user.color;
      avatar.onerror = () => {
        const fallback = document.createElement('div');
        fallback.className = 'hive-panel-user-avatar hive-panel-user-avatar-fallback';
        fallback.style.backgroundColor = user.color;
        fallback.textContent = user.username.charAt(0).toUpperCase();
        avatar.replaceWith(fallback);
      };

      const meta = item.createDiv({ cls: 'hive-panel-user-meta' });
      meta.createDiv({ cls: 'hive-panel-user-name', text: `@${user.username}` });

      if (user.statusMessage) {
        meta.createDiv({
          cls: 'hive-panel-user-status',
          text: `"${user.statusMessage}"`,
        });
      }

      // Open files
      if (user.openFiles.size > 0) {
        const filesEl = meta.createDiv({ cls: 'hive-panel-user-files' });
        for (const filePath of user.openFiles) {
          const fileRow = filesEl.createDiv({ cls: 'hive-panel-file-row' });
          fileRow.createSpan({ text: `› ${filePath}` });

          const navBtn = fileRow.createEl('button', {
            cls: 'hive-panel-file-nav',
            text: '→',
          });
          navBtn.addEventListener('click', () => {
            void this.plugin.app.workspace.openLinkText(filePath, '', false);
          });
        }
      }

      // Follow / Unfollow button
      const isFollowing = this.plugin.followTargetId === userId;
      const followBtn = item.createEl('button', {
        cls: 'hive-panel-follow-btn',
        text: isFollowing ? 'Unfollow' : 'Follow',
      });
      followBtn.addEventListener('click', () => {
        this.plugin.setFollowTarget(isFollowing ? null : userId);
        this.render();
      });
    }
  }
}
