import { HiveUser } from '../types';

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('Malformed JWT');
  }

  return JSON.parse(decodeBase64Url(parts[1]));
}

function readRequiredString(payload: Record<string, unknown>, claim: string): string {
  const value = payload[claim];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Token missing required claim: ${claim}`);
  }
  return value;
}

export function decodeUserFromToken(token: string): HiveUser {
  const payload = decodeJwtPayload(token);
  return {
    id: readRequiredString(payload, 'id'),
    username: readRequiredString(payload, 'username'),
    avatarUrl: typeof payload.avatarUrl === 'string' ? payload.avatarUrl : '',
  };
}
