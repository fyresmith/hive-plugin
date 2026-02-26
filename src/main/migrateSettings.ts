import { DEFAULT_SETTINGS, PluginSettings } from '../types';

export function migrateSettings(raw: Record<string, unknown>): {
  settings: PluginSettings;
  didMigrate: boolean;
} {
  let didMigrate = false;

  // Remove stale field from earlier versions
  if ('enabled' in raw) {
    delete raw['enabled'];
    didMigrate = true;
  }

  const settings = Object.assign({}, DEFAULT_SETTINGS, raw) as PluginSettings;

  return { settings, didMigrate };
}
