import { App, MarkdownView } from 'obsidian';

/**
 * Programmatically disable a plugin by ID.
 * Accesses the private `app.plugins` API — not part of the official Obsidian API.
 */
export function disablePlugin(app: App, pluginId: string): Promise<void> | void {
  const plugins = (app as any).plugins as
    | { disablePlugin?: (id: string) => Promise<void> | void }
    | undefined;
  return plugins?.disablePlugin?.(pluginId);
}

/**
 * Open the plugin settings tab identified by pluginId.
 * Accesses the private `app.setting` API — not part of the official Obsidian API.
 */
export function openSettingTab(app: App, pluginId: string): void {
  const setting = (app as any).setting as
    | { open?: () => void; openTabById?: (id: string) => void }
    | undefined;
  if (typeof setting?.open === 'function') setting.open();
  if (typeof setting?.openTabById === 'function') setting.openTabById(pluginId);
}

/**
 * Get the current editor mode ('source' | 'preview' | 'live') for a MarkdownView.
 * Accesses the private `view.getMode()` method — not part of the official Obsidian API.
 * Returns null if the method is unavailable.
 */
export function getEditorMode(view: MarkdownView): string | null {
  const mode = (view as any).getMode?.();
  return typeof mode === 'string' ? mode : null;
}
