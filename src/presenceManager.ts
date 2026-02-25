import { DiscordUser, RemoteUser, PluginSettings, ClaimState } from './types';
import { getUserColor } from './cursorColor';

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
  private claims = new Map<string, ClaimState>();       // filePath → claim
  private lastEditedBy = new Map<string, string>();     // filePath → username

  /** Called whenever any user/file state changes — used to trigger UI re-renders. */
  onChanged?: () => void;

  constructor(private settings: PluginSettings) {}

  // ---------------------------------------------------------------------------
  // Public read-only accessors
  // ---------------------------------------------------------------------------

  getRemoteUsers(): ReadonlyMap<string, RemoteUser> {
    return this.remoteUsers;
  }

  getRemoteUserCount(): number {
    return this.remoteUsers.size;
  }

  getClaim(relPath: string): ClaimState | undefined {
    return this.claims.get(relPath);
  }

  getLastEditedBy(relPath: string): string | undefined {
    return this.lastEditedBy.get(relPath);
  }

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
      this.onChanged?.();
      return;
    }

    this.remoteUsers.set(user.id, {
      ...user,
      color,
      openFiles: new Set(),
    });
    this.onChanged?.();
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
    this.onChanged?.();
  }

  handleFileOpened(relPath: string, user: PresenceUser): void {
    this.handleUserJoined(user);

    if (!this.fileViewers.has(relPath)) {
      this.fileViewers.set(relPath, new Set());
    }
    this.fileViewers.get(relPath)!.add(user.id);
    this.remoteUsers.get(user.id)?.openFiles.add(relPath);

    this.renderAvatarsForPath(relPath);
    this.onChanged?.();
  }

  handleFileClosed(relPath: string, userId: string): void {
    this.fileViewers.get(relPath)?.delete(userId);
    this.remoteUsers.get(userId)?.openFiles.delete(relPath);
    this.renderAvatarsForPath(relPath);
    this.onChanged?.();
  }

  handleFileClaimed(relPath: string, user: { id: string; username: string; color: string }): void {
    this.claims.set(relPath, { userId: user.id, username: user.username, color: user.color });
    this.renderClaimBadge(relPath);
    this.onChanged?.();
  }

  handleFileUnclaimed(relPath: string): void {
    this.claims.delete(relPath);
    this.renderClaimBadge(relPath);
    this.onChanged?.();
  }

  handleUserStatusChanged(userId: string, status: string): void {
    const user = this.remoteUsers.get(userId);
    if (!user) return;
    user.statusMessage = status;
    this.onChanged?.();
  }

  handleFileUpdated(relPath: string, username: string): void {
    this.lastEditedBy.set(relPath, username);
    const escaped = CSS.escape(relPath);
    document.querySelectorAll(`.nav-file-title[data-path="${escaped}"]`).forEach((el) => {
      (el as HTMLElement).title = `Last edited by @${username}`;
    });
    this.onChanged?.();
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

  private renderClaimBadge(relPath: string): void {
    const escaped = CSS.escape(relPath);
    const titleEls = document.querySelectorAll(`.nav-file-title[data-path="${escaped}"]`);
    for (const titleEl of titleEls) {
      titleEl.querySelectorAll('.hive-claim-badge').forEach((el) => el.remove());
      const claim = this.claims.get(relPath);
      if (!claim) {
        titleEl.classList.remove('has-hive-claim');
        continue;
      }
      const badge = document.createElement('span');
      badge.className = 'hive-claim-badge';
      badge.style.backgroundColor = claim.color;
      badge.title = `Claimed by @${claim.username}`;
      badge.textContent = claim.username.charAt(0).toUpperCase();
      titleEl.classList.add('has-hive-claim');
      titleEl.appendChild(badge);
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  unregister(): void {
    document.querySelectorAll('.hive-avatars').forEach((el) => el.remove());
    document.querySelectorAll('.nav-file-title.has-hive-avatars').forEach((el) => {
      el.classList.remove('has-hive-avatars');
    });
    document.querySelectorAll('.hive-claim-badge').forEach((el) => el.remove());
    document.querySelectorAll('.nav-file-title.has-hive-claim').forEach((el) => {
      el.classList.remove('has-hive-claim');
    });
    this.remoteUsers.clear();
    this.fileViewers.clear();
    this.claims.clear();
    this.lastEditedBy.clear();
  }
}
