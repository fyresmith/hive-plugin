import { DiscordUser, RemoteUser, PluginSettings } from './types';
import { getUserColor } from './collabEditor';

type PresenceUser = DiscordUser & { color?: string | null };

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function normalizePresenceColor(color: string | null | undefined): string | null {
  if (!color) return null;
  const trimmed = color.trim();
  return HEX_COLOR_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

export class PresenceManager {
  private remoteUsers = new Map<string, RemoteUser>();
  private fileViewers = new Map<string, Set<string>>(); // path → Set<discordId>

  constructor(private settings: PluginSettings) {}

  // ---------------------------------------------------------------------------
  // Event handlers — called from main.ts socket listeners
  // ---------------------------------------------------------------------------

  handleUserJoined(user: PresenceUser): void {
    const color = normalizePresenceColor(user.color) ?? getUserColor(user.id);
    const existing = this.remoteUsers.get(user.id);
    if (existing) {
      existing.username = user.username;
      existing.avatarUrl = user.avatarUrl;
      existing.color = color;
      return;
    }

    this.remoteUsers.set(user.id, {
      ...user,
      color,
      openFiles: new Set(),
    });
  }

  handleUserLeft(userId: string): void {
    const user = this.remoteUsers.get(userId);
    if (!user) return;

    // Remove from all file viewer sets
    for (const [path, viewers] of this.fileViewers) {
      if (viewers.delete(userId)) {
        this.renderAvatarsForPath(path);
      }
    }

    this.remoteUsers.delete(userId);
  }

  handleFileOpened(relPath: string, user: PresenceUser): void {
    this.handleUserJoined(user);

    if (!this.fileViewers.has(relPath)) {
      this.fileViewers.set(relPath, new Set());
    }
    this.fileViewers.get(relPath)!.add(user.id);
    this.remoteUsers.get(user.id)?.openFiles.add(relPath);

    this.renderAvatarsForPath(relPath);
  }

  handleFileClosed(relPath: string, userId: string): void {
    this.fileViewers.get(relPath)?.delete(userId);
    this.remoteUsers.get(userId)?.openFiles.delete(relPath);
    this.renderAvatarsForPath(relPath);
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // ---------------------------------------------------------------------------

  renderAvatarsForPath(relPath: string): void {
    if (!this.settings.showPresenceAvatars) {
      this.removeAvatarContainer(relPath);
      return;
    }

    // Escape the path for use in a CSS attribute selector
    const escaped = CSS.escape(relPath);
    const titleEls = document.querySelectorAll(`.nav-file-title[data-path="${escaped}"]`);
    if (titleEls.length === 0) return;

    this.removeAvatarContainer(relPath);

    const viewers = this.fileViewers.get(relPath);
    if (!viewers || viewers.size === 0) return;

    for (const titleEl of titleEls) {
      const container = document.createElement('div');
      container.className = 'hive-avatars';
      container.dataset.path = relPath;
      titleEl.classList.add('has-hive-avatars');

      const MAX_VISIBLE = 3;
      const viewerArray = [...viewers];
      const visibleViewers = viewerArray.slice(0, MAX_VISIBLE);
      const overflowCount = viewerArray.length - MAX_VISIBLE;

      for (const userId of visibleViewers) {
        const user = this.remoteUsers.get(userId);
        if (!user) continue;

        const img = document.createElement('img');
        img.className = 'hive-avatar';
        img.src = user.avatarUrl;
        img.title = user.username;
        img.dataset.id = userId;
        img.style.borderColor = user.color;
        img.onerror = () => {
          const fallback = document.createElement('span');
          fallback.className = 'hive-avatar hive-avatar-fallback';
          fallback.title = user.username;
          fallback.dataset.id = userId;
          fallback.style.borderColor = user.color;
          fallback.style.backgroundColor = user.color;
          fallback.textContent = user.username.charAt(0).toUpperCase();
          img.replaceWith(fallback);
        };

        container.appendChild(img);
      }

      if (overflowCount > 0) {
        const overflow = document.createElement('span');
        overflow.className = 'hive-avatar-overflow';
        overflow.textContent = `+${overflowCount}`;
        container.appendChild(overflow);
      }

      titleEl.appendChild(container);
    }
  }

  private removeAvatarContainer(relPath: string): void {
    const escaped = CSS.escape(relPath);
    document
      .querySelectorAll(`.nav-file-title[data-path="${escaped}"]`)
      .forEach((titleEl) => {
        titleEl.querySelectorAll('.hive-avatars').forEach((el) => el.remove());
        titleEl.classList.remove('has-hive-avatars');
      });
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  unregister(): void {
    document.querySelectorAll('.hive-avatars').forEach((el) => el.remove());
    document.querySelectorAll('.nav-file-title.has-hive-avatars').forEach((el) => {
      el.classList.remove('has-hive-avatars');
    });
    this.remoteUsers.clear();
    this.fileViewers.clear();
  }
}
