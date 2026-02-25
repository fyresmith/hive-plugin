export interface PluginSettings {
  serverUrl: string;
  token: string | null;
  user: DiscordUser | null;
  showPresenceAvatars: boolean;
  cursorColor: string | null;
  useProfileForCursor: boolean;
  notificationModeGlobal: 'all' | 'mute' | 'focus' | 'digest';
  presenceHeartbeatMs: number;
}

export interface DiscordUser {
  id: string;
  username: string;
  avatarUrl: string;
}

export interface ManifestEntry {
  path: string;
  hash: string;
  mtime: number;
  size: number;
}

export interface RemoteUser extends DiscordUser {
  color: string;
  openFiles: Set<string>;
}

export interface AwarenessUser {
  name: string;
  avatarUrl: string;
  color: string;
}

export type ConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'connecting'
  | 'auth-required';

export const DEFAULT_SETTINGS: PluginSettings = {
  serverUrl: 'https://collab.calebmsmith.com',
  token: null,
  user: null,
  showPresenceAvatars: true,
  cursorColor: null,
  useProfileForCursor: false,
  notificationModeGlobal: 'all',
  presenceHeartbeatMs: 10000,
};
