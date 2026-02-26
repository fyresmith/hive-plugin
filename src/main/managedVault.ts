import type { DataAdapter } from 'obsidian';
import type { ManagedVaultBinding } from '../types';

export const MANAGED_BINDING_PATH = '.obsidian/hive-managed.json';

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
