import { DiscordUser, RemoteUser, PluginSettings } from './types';
import { getUserColor } from './cursorColor';

type PresenceUser = DiscordUser & { color?: string | null };

interface PresenceLocation {
  activeFile: string | null;
  cursor?: { line: number; ch: number } | null;
  viewport?: { x: number; y: number; zoom?: number } | null;
  lastSeenAt: number;
}

export interface ActiveEditorEntry {
  userId: string;
  username: string;
  avatarUrl: string;
  color: string;
  openFiles: string[];
  activeFile: string | null;
  cursor: PresenceLocation['cursor'];
  viewport: PresenceLocation['viewport'];
  lastSeenAt: number;
  stale: boolean;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function normalizePresenceColor(color: string | null | undefined): string | null {
  if (!color) return null;
  const trimmed = color.trim();
  return HEX_COLOR_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

export class PresenceManager {
  private remoteUsers = new Map<string, RemoteUser>();
  private fileViewers = new Map<string, Set<string>>(); // path -> Set<discordId>
  private locations = new Map<string, PresenceLocation>();
  private listeners = new Set<() => void>();

  constructor(private settings: PluginSettings) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
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
      this.emitChange();
      return;
    }

    this.remoteUsers.set(user.id, {
      ...user,
      color,
      openFiles: new Set(),
    });
    this.emitChange();
  }

  handleUserLeft(userId: string): void {
    const user = this.remoteUsers.get(userId);
    if (!user) return;

    for (const [path, viewers] of this.fileViewers) {
      if (viewers.delete(userId)) {
        this.renderAvatarsForPath(path);
      }
      if (viewers.size === 0) {
        this.fileViewers.delete(path);
      }
    }

    this.locations.delete(userId);
    this.remoteUsers.delete(userId);
    this.emitChange();
  }

  handleFileOpened(relPath: string, user: PresenceUser): void {
    this.handleUserJoined(user);

    if (!this.fileViewers.has(relPath)) {
      this.fileViewers.set(relPath, new Set());
    }
    this.fileViewers.get(relPath)!.add(user.id);
    this.remoteUsers.get(user.id)?.openFiles.add(relPath);

    const existing = this.locations.get(user.id);
    this.locations.set(user.id, {
      activeFile: relPath,
      cursor: existing?.cursor ?? null,
      viewport: existing?.viewport ?? null,
      lastSeenAt: Date.now(),
    });

    this.renderAvatarsForPath(relPath);
    this.emitChange();
  }

  handleFileClosed(relPath: string, userId: string): void {
    this.fileViewers.get(relPath)?.delete(userId);
    this.remoteUsers.get(userId)?.openFiles.delete(relPath);
    if (this.fileViewers.get(relPath)?.size === 0) {
      this.fileViewers.delete(relPath);
    }

    const current = this.locations.get(userId);
    if (current && current.activeFile === relPath) {
      this.locations.set(userId, {
        ...current,
        activeFile: null,
        lastSeenAt: Date.now(),
      });
    }

    this.renderAvatarsForPath(relPath);
    this.emitChange();
  }

  handlePresenceHeartbeat(payload: {
    user: PresenceUser;
    location?: {
      activeFile?: string | null;
      cursor?: { line: number; ch: number } | null;
      viewport?: { x: number; y: number; zoom?: number } | null;
    } | null;
    ts?: number;
  }): void {
    if (!payload?.user?.id) return;
    this.handleUserJoined(payload.user);

    const previous = this.locations.get(payload.user.id);
    this.locations.set(payload.user.id, {
      activeFile: payload.location?.activeFile ?? previous?.activeFile ?? null,
      cursor: payload.location?.cursor ?? previous?.cursor ?? null,
      viewport: payload.location?.viewport ?? previous?.viewport ?? null,
      lastSeenAt: typeof payload.ts === 'number' ? payload.ts : Date.now(),
    });

    this.emitChange();
  }

  hydratePresenceList(users: Array<{
    user: PresenceUser;
    openFiles?: string[];
    activeFile?: string | null;
    cursor?: { line: number; ch: number } | null;
    viewport?: { x: number; y: number; zoom?: number } | null;
    lastSeenAt?: number | null;
  }>): void {
    this.fileViewers.clear();

    for (const entry of users) {
      if (!entry?.user?.id) continue;
      this.handleUserJoined(entry.user);
      const openFiles = Array.isArray(entry.openFiles) ? entry.openFiles : [];
      const remote = this.remoteUsers.get(entry.user.id);
      if (remote) {
        remote.openFiles = new Set(openFiles);
      }

      for (const path of openFiles) {
        if (!this.fileViewers.has(path)) {
          this.fileViewers.set(path, new Set());
        }
        this.fileViewers.get(path)!.add(entry.user.id);
      }

      this.locations.set(entry.user.id, {
        activeFile: entry.activeFile ?? openFiles[0] ?? null,
        cursor: entry.cursor ?? null,
        viewport: entry.viewport ?? null,
        lastSeenAt: typeof entry.lastSeenAt === 'number' ? entry.lastSeenAt : Date.now(),
      });
    }

    for (const path of this.fileViewers.keys()) {
      this.renderAvatarsForPath(path);
    }

    this.emitChange();
  }

  // ---------------------------------------------------------------------------
  // Read APIs for panel/follow mode
  // ---------------------------------------------------------------------------

  getUserLocation(userId: string): PresenceLocation | null {
    return this.locations.get(userId) ?? null;
  }

  getActiveEditorsForPath(relPath: string, staleMs = 45_000): ActiveEditorEntry[] {
    const viewers = this.fileViewers.get(relPath);
    if (!viewers || viewers.size === 0) return [];

    const now = Date.now();
    const out: ActiveEditorEntry[] = [];
    for (const userId of viewers) {
      const user = this.remoteUsers.get(userId);
      if (!user) continue;
      const location = this.locations.get(userId);
      out.push({
        userId,
        username: user.username,
        avatarUrl: user.avatarUrl,
        color: user.color,
        openFiles: [...user.openFiles],
        activeFile: location?.activeFile ?? null,
        cursor: location?.cursor ?? null,
        viewport: location?.viewport ?? null,
        lastSeenAt: location?.lastSeenAt ?? 0,
        stale: location ? (now - location.lastSeenAt) > staleMs : true,
      });
    }

    return out.sort((a, b) => a.username.localeCompare(b.username));
  }

  getWorkspaceActiveEditors(staleMs = 45_000): ActiveEditorEntry[] {
    const now = Date.now();
    const out: ActiveEditorEntry[] = [];

    for (const [userId, user] of this.remoteUsers) {
      const location = this.locations.get(userId);
      out.push({
        userId,
        username: user.username,
        avatarUrl: user.avatarUrl,
        color: user.color,
        openFiles: [...user.openFiles],
        activeFile: location?.activeFile ?? null,
        cursor: location?.cursor ?? null,
        viewport: location?.viewport ?? null,
        lastSeenAt: location?.lastSeenAt ?? 0,
        stale: location ? (now - location.lastSeenAt) > staleMs : true,
      });
    }

    return out.sort((a, b) => a.username.localeCompare(b.username));
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // ---------------------------------------------------------------------------

  renderAvatarsForPath(relPath: string): void {
    if (!this.settings.showPresenceAvatars) {
      this.removeAvatarContainer(relPath);
      return;
    }

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
    this.listeners.clear();
    this.locations.clear();
    this.remoteUsers.clear();
    this.fileViewers.clear();
  }

  getViewerNamesForPath(relPath: string): string[] {
    const viewers = this.fileViewers.get(relPath);
    if (!viewers || viewers.size === 0) return [];
    const names: string[] = [];
    for (const userId of viewers) {
      const user = this.remoteUsers.get(userId);
      if (!user) continue;
      names.push(user.username);
    }
    return names.sort((a, b) => a.localeCompare(b));
  }
}
