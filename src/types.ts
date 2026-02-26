export interface SyncHashCacheEntry {
  hash: string;
  mtime: number;
  size: number;
}

export interface PluginSettings {
  serverUrl: string;
  bootstrapServerUrl: string;
  token: string | null;
  bootstrapToken: string | null;
  user: HiveUser | null;
  showPresenceAvatars: boolean;
  cursorColor: string | null;
  useProfileForCursor: boolean;
  followTargetId: string | null;
  statusMessage: string;
  syncHashCache: Record<string, SyncHashCacheEntry>;
}

export interface ManagedVaultBinding {
  version: number;
  managed: true;
  serverUrl: string;
  vaultId: string;
  createdAt: string;
}

export interface HiveUser {
  id: string;
  username: string;
  avatarUrl?: string;
}

export interface ManifestEntry {
  path: string;
  hash: string;
  mtime: number;
  size: number;
}

export interface RemoteUser extends HiveUser {
  color: string;
  openFiles: Set<string>;
  statusMessage?: string;
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

export interface ClaimState {
  userId: string;
  username: string;
  color: string;
}

export type UserStatusPayload = { userId: string; status: string };
export type FileClaimPayload = { relPath: string; user: { id: string; username: string; color: string } };
export type FileUnclaimPayload = { relPath: string; userId: string };

export const DEFAULT_SETTINGS: PluginSettings = {
  serverUrl: '',
  bootstrapServerUrl: '',
  token: null,
  bootstrapToken: null,
  user: null,
  showPresenceAvatars: true,
  cursorColor: null,
  useProfileForCursor: false,
  followTargetId: null,
  statusMessage: '',
  syncHashCache: {},
};
