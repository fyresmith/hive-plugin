import type { App, DataAdapter } from 'obsidian';
import { Notice } from 'obsidian';
import { SocketClient } from '../socket';
import { DEFAULT_SETTINGS } from '../types';
import type { HiveUser, ManagedVaultBinding, PluginSettings } from '../types';

export const MANAGED_BINDING_PATH = '.obsidian/hive-managed.json';
const MANAGED_BINDING_VERSION = 1;

export interface ManagedStatusResponse {
  managedInitialized: boolean;
  vaultId: string | null;
  role: 'owner' | 'member' | 'none';
  isOwner: boolean;
  isMember: boolean;
  ownerId?: string;
  memberCount?: number;
}

interface ManagedApiPayload {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

interface BootstrapManagedVaultOptions {
  pluginId: string;
  sourceVaultBasePath: string;
  destinationPath: string;
  serverUrl: string;
  token: string;
  user: HiveUser;
  binding: ManagedVaultBinding;
}

interface BootstrapManagedVaultResult {
  pulledFiles: number;
  destinationPath: string;
}

type NodeModules = {
  fs: {
    existsSync: (path: string) => boolean;
  };
  fsp: {
    copyFile: (src: string, dest: string) => Promise<void>;
    mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
    readdir: (path: string) => Promise<string[]>;
    readFile: (path: string, encoding: string) => Promise<string>;
    stat: (path: string) => Promise<{ isDirectory: () => boolean }>;
    writeFile: (path: string, data: string, encoding: string) => Promise<void>;
  };
  path: {
    dirname: (path: string) => string;
    isAbsolute: (path: string) => boolean;
    join: (...parts: string[]) => string;
    resolve: (...parts: string[]) => string;
    sep: string;
  };
};

function getNodeModules(): NodeModules {
  // Accesses Node.js require() via Electron's window/globalThis bridge — not a public API.
  const req = (window as any)?.require ?? (globalThis as any)?.require;
  if (!req) {
    throw new Error('Desktop Node integration is unavailable.');
  }
  return {
    fs: req('fs'),
    fsp: req('fs/promises'),
    path: req('path'),
  } as NodeModules;
}

function safeJsonParse<T>(input: string): T | null {
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}

export function normalizeServerUrl(input: string): string {
  return String(input ?? '').trim().replace(/\/+$/, '');
}

export function coerceServerUrl(input: string): string {
  const trimmed = normalizeServerUrl(input);
  if (!trimmed) {
    throw new Error('Server URL is required.');
  }

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error('Server URL is invalid. Example: https://collab.example.com');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Server URL must start with http:// or https://');
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  const suffix = `${path}${parsed.search}${parsed.hash}`;
  return `${parsed.origin}${suffix === '/' ? '' : suffix}`;
}

export function isValidManagedBinding(value: unknown): value is ManagedVaultBinding {
  const v = value as Partial<ManagedVaultBinding> | null;
  if (!v || typeof v !== 'object') return false;
  if (v.managed !== true) return false;
  if (typeof v.version !== 'number' || v.version < 1) return false;
  if (!normalizeServerUrl(v.serverUrl ?? '')) return false;
  if (!String(v.vaultId ?? '').trim()) return false;
  if (!String(v.createdAt ?? '').trim()) return false;
  return true;
}

export async function readManagedBinding(adapter: DataAdapter): Promise<ManagedVaultBinding | null> {
  // Accesses DataAdapter's internal exists/read methods — not typed in the public API.
  const adapterAny = adapter as any;
  if (!adapterAny?.exists || !adapterAny?.read) return null;

  const exists = await adapterAny.exists(MANAGED_BINDING_PATH);
  if (!exists) return null;
  const raw = await adapterAny.read(MANAGED_BINDING_PATH);
  const parsed = safeJsonParse<ManagedVaultBinding>(raw);
  if (!parsed || !isValidManagedBinding(parsed)) return null;
  let serverUrl: string;
  try {
    serverUrl = coerceServerUrl(parsed.serverUrl);
  } catch {
    return null;
  }
  return {
    ...parsed,
    serverUrl,
  };
}

export function createManagedBinding(serverUrl: string, vaultId: string): ManagedVaultBinding {
  return {
    version: MANAGED_BINDING_VERSION,
    managed: true,
    serverUrl: coerceServerUrl(serverUrl),
    vaultId: String(vaultId ?? '').trim(),
    createdAt: new Date().toISOString(),
  };
}

export function getCurrentVaultBasePath(app: App): string | null {
  // Accesses FileSystemAdapter.basePath — not part of the typed DataAdapter interface.
  const adapter = app.vault.adapter as any;
  const basePath = String(adapter?.basePath ?? '').trim();
  return basePath || null;
}

export class ManagedApiClient {
  constructor(
    private serverUrl: string,
    private token: string,
  ) {}

  private async request<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
    const url = `${this.serverUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'network error';
      throw new Error(
        `Failed to reach ${url}. Check server URL, server status, and TLS certificate. (${reason})`,
      );
    }

    const payload = await res.json().catch(() => null) as ManagedApiPayload | null;
    if (!res.ok || !payload?.ok) {
      const message = payload?.error || `Request failed (${res.status})`;
      throw new Error(message);
    }
    return payload as unknown as T;
  }

  status(): Promise<ManagedStatusResponse> {
    return this.request<ManagedStatusResponse>('GET', '/managed/status');
  }

  init(): Promise<{ vaultId: string }> {
    return this.request<{ vaultId: string }>('POST', '/managed/init');
  }

  pair(code: string): Promise<{ vaultId: string }> {
    return this.request<{ vaultId: string }>('POST', '/managed/pair', { code });
  }
}

async function waitForSocketConnected(socket: SocketClient, timeoutMs = 15000): Promise<void> {
  if (socket.connected) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
      reject(new Error('Timed out connecting to Hive server'));
    }, timeoutMs);

    const onConnect = () => {
      clearTimeout(timer);
      socket.off('connect_error', onConnectError);
      resolve();
    };
    const onConnectError = (err: Error) => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      reject(err);
    };

    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);
  });
}

async function ensureEmptyDestination(destinationPath: string): Promise<void> {
  const { fs, fsp } = getNodeModules();
  if (!fs.existsSync(destinationPath)) {
    await fsp.mkdir(destinationPath, { recursive: true });
    return;
  }
  const stat = await fsp.stat(destinationPath);
  if (!stat.isDirectory()) {
    throw new Error(`Destination is not a directory: ${destinationPath}`);
  }
  const entries = await fsp.readdir(destinationPath);
  if (entries.length > 0) {
    throw new Error('Destination folder must be empty.');
  }
}

function safeJoinDestination(destinationPath: string, relPath: string): string {
  const { path } = getNodeModules();
  const root = path.resolve(destinationPath);
  const abs = path.resolve(destinationPath, relPath);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error(`Unsafe path received from server: ${relPath}`);
  }
  return abs;
}

async function hydrateFromServer(serverUrl: string, token: string, vaultId: string, destinationPath: string): Promise<number> {
  const socket = new SocketClient(serverUrl, token, vaultId);
  try {
    await waitForSocketConnected(socket);
    const manifestRes = await socket.request<{ manifest: Array<{ path: string }> }>('vault-sync-request');
    let pulled = 0;

    for (const entry of manifestRes.manifest) {
      const relPath = entry.path;
      const fileRes = await socket.request<{ content: string }>('file-read', relPath);
      const abs = safeJoinDestination(destinationPath, relPath);
      const { fsp, path } = getNodeModules();
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, fileRes.content, 'utf-8');
      pulled += 1;
    }

    return pulled;
  } finally {
    socket.disconnect();
  }
}

async function writeManagedBindingForDestination(destinationPath: string, binding: ManagedVaultBinding): Promise<void> {
  const { fsp, path } = getNodeModules();
  const target = path.join(destinationPath, MANAGED_BINDING_PATH);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, `${JSON.stringify(binding, null, 2)}\n`, 'utf-8');
}

async function copyPluginAssets(pluginId: string, sourceVaultBasePath: string, destinationPath: string): Promise<void> {
  const { fs, fsp, path } = getNodeModules();
  const srcDir = path.join(sourceVaultBasePath, '.obsidian', 'plugins', pluginId);
  const dstDir = path.join(destinationPath, '.obsidian', 'plugins', pluginId);
  const requiredFiles = ['main.js', 'manifest.json', 'styles.css'];

  await fsp.mkdir(dstDir, { recursive: true });

  for (const filename of requiredFiles) {
    const src = path.join(srcDir, filename);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing plugin asset: ${src}`);
    }
    const dst = path.join(dstDir, filename);
    await fsp.copyFile(src, dst);
  }
}

async function enableCommunityPlugin(pluginId: string, destinationPath: string): Promise<void> {
  const { fs, fsp, path } = getNodeModules();

  const communityPluginsPath = path.join(destinationPath, '.obsidian', 'community-plugins.json');
  const appJsonPath = path.join(destinationPath, '.obsidian', 'app.json');

  let plugins: string[] = [];
  if (fs.existsSync(communityPluginsPath)) {
    const raw = await fsp.readFile(communityPluginsPath, 'utf-8');
    const parsed = safeJsonParse<string[]>(raw);
    if (Array.isArray(parsed)) plugins = parsed;
  }
  if (!plugins.includes(pluginId)) plugins.push(pluginId);
  await fsp.mkdir(path.dirname(communityPluginsPath), { recursive: true });
  await fsp.writeFile(communityPluginsPath, `${JSON.stringify(plugins, null, 2)}\n`, 'utf-8');

  let appConfig: Record<string, unknown> = {};
  if (fs.existsSync(appJsonPath)) {
    const raw = await fsp.readFile(appJsonPath, 'utf-8');
    const parsed = safeJsonParse<Record<string, unknown>>(raw);
    if (parsed && typeof parsed === 'object') appConfig = parsed;
  }
  appConfig.communityPluginEnabled = true;
  await fsp.writeFile(appJsonPath, `${JSON.stringify(appConfig, null, 2)}\n`, 'utf-8');
}

async function writePluginDataFile(
  pluginId: string,
  destinationPath: string,
  binding: ManagedVaultBinding,
  user: HiveUser,
  token: string,
): Promise<void> {
  const { fsp, path } = getNodeModules();
  const pluginDataPath = path.join(destinationPath, '.obsidian', 'plugins', pluginId, 'data.json');
  const nextSettings: PluginSettings = {
    ...DEFAULT_SETTINGS,
    serverUrl: binding.serverUrl,
    bootstrapServerUrl: binding.serverUrl,
    token,
    user,
  };
  await fsp.mkdir(path.dirname(pluginDataPath), { recursive: true });
  await fsp.writeFile(pluginDataPath, `${JSON.stringify(nextSettings, null, 2)}\n`, 'utf-8');
}

export async function bootstrapManagedVault(options: BootstrapManagedVaultOptions): Promise<BootstrapManagedVaultResult> {
  await ensureEmptyDestination(options.destinationPath);

  const pulledFiles = await hydrateFromServer(
    options.serverUrl,
    options.token,
    options.binding.vaultId,
    options.destinationPath,
  );

  await writeManagedBindingForDestination(options.destinationPath, options.binding);
  await copyPluginAssets(options.pluginId, options.sourceVaultBasePath, options.destinationPath);
  await writePluginDataFile(
    options.pluginId,
    options.destinationPath,
    options.binding,
    options.user,
    options.token,
  );
  await enableCommunityPlugin(options.pluginId, options.destinationPath);

  return {
    pulledFiles,
    destinationPath: options.destinationPath,
  };
}

export async function tryOpenVault(app: App, destinationPath: string): Promise<boolean> {
  // Accesses app.openVault() — private Electron/Obsidian desktop API.
  const appAny = app as any;
  if (typeof appAny?.openVault === 'function') {
    try {
      await appAny.openVault(destinationPath);
      return true;
    } catch {
      // fall through to URI fallback
    }
  }

  try {
    const popup = window.open(`obsidian://open?path=${encodeURIComponent(destinationPath)}`, '_blank');
    return Boolean(popup);
  } catch {
    return false;
  }
}

export function assertAbsolutePath(input: string): string {
  const value = String(input ?? '').trim();
  if (!value) throw new Error('Path is required');
  const { path } = getNodeModules();
  if (!path.isAbsolute(value)) {
    throw new Error('Path must be absolute');
  }
  return value;
}

export function showManualOpenNotice(destinationPath: string): void {
  new Notice(`Managed Vault created at ${destinationPath}. Open this folder in Obsidian if it did not switch automatically.`, 10000);
}
