import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { Compartment, EditorState, StateEffect } from '@codemirror/state';
import { keymap, EditorView } from '@codemirror/view';
import { MarkdownView, setIcon } from 'obsidian';
import { DiscordUser } from './types';
import { suppress, unsuppress } from './suppressedPaths';
import { normalizeCursorColor, resolveUserColor, toCursorHighlight } from './cursorColor';

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function labelTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return L > 0.179 ? '#1a1a1a' : '#ffffff';
}

function buildAvatarFallback(name: string, color: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'hive-active-editors-avatar hive-active-editors-avatar-fallback';
  el.textContent = (name || '?').charAt(0).toUpperCase();
  el.title = `@${name}`;
  if (color) el.style.backgroundColor = color;
  return el;
}

// ---------------------------------------------------------------------------
// CollabEditor
// ---------------------------------------------------------------------------

export class CollabEditor {
  private ydoc: Y.Doc | null = null;
  private provider: WebsocketProvider | null = null;
  private undoManager: Y.UndoManager | null = null;
  private yText: Y.Text | null = null;
  private live = false;
  private destroyed = false;

  private views = new Map<string, {
    view: MarkdownView;
    collabCompartment: Compartment | null;
    readOnlyCompartment: Compartment | null;
    collabAttached: boolean;
    editorPollTimer: ReturnType<typeof setTimeout> | null;
    loading: boolean;
    overlayEl: HTMLElement | null;
    guardContainer: HTMLElement | null;
    guardHandler: (evt: Event) => void;
    caretObserver: MutationObserver | null;
    caretObserverTarget: HTMLElement | null;
    bannerEl: HTMLElement | null;
    markersEl: HTMLElement | null;
  }>();

  constructor(
    private serverUrl: string,
    private vaultId: string,
    private filePath: string,
    private user: DiscordUser,
    private token: string,
    private cursorColor: string | null,
    private useProfileForCursor: boolean,
    private onLiveChange?: (live: boolean) => void,
  ) {}

  private getEditorView(view: MarkdownView): EditorView | null {
    const cm = (view.editor as any).cm as EditorView | undefined;
    return cm ?? null;
  }

  private getViewContainer(view: MarkdownView): HTMLElement | null {
    const container = (view as any).containerEl as HTMLElement | undefined;
    return container ?? null;
  }

  private setLive(live: boolean): void {
    if (this.live === live) return;
    this.live = live;
    this.onLiveChange?.(live);
  }

  isEmpty(): boolean {
    return this.views.size === 0;
  }

  private applyReadOnly(bindingKey: string, readOnly: boolean): void {
    const binding = this.views.get(bindingKey);
    if (!binding) return;

    const cm = this.getEditorView(binding.view);
    if (!cm) {
      this.scheduleEditorPoll(bindingKey);
      return;
    }

    if (!binding.readOnlyCompartment) {
      binding.readOnlyCompartment = new Compartment();
      cm.dispatch({
        effects: StateEffect.appendConfig.of(
          binding.readOnlyCompartment.of(EditorState.readOnly.of(readOnly))
        ),
      });
      return;
    }

    cm.dispatch({
      effects: binding.readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }

  private ensureLoadingOverlay(bindingKey: string): void {
    const binding = this.views.get(bindingKey);
    if (!binding) return;
    const container = this.getViewContainer(binding.view);
    if (!container) return;

    container.classList.add('hive-collab-container');
    container.classList.toggle('hive-collab-lock', binding.loading);

    if (!binding.overlayEl || !binding.overlayEl.isConnected) {
      const overlay = document.createElement('div');
      overlay.className = 'hive-collab-loading-overlay';
      overlay.innerHTML = `
        <div class="hive-collab-loading-card">
          <div class="hive-collab-spinner" aria-hidden="true"></div>
          <div class="hive-collab-loading-text">Connecting to live room…</div>
        </div>
      `;
      container.appendChild(overlay);
      binding.overlayEl = overlay;
    }

    binding.overlayEl.classList.toggle('is-visible', binding.loading);
  }

  private installInputGuard(bindingKey: string): void {
    const binding = this.views.get(bindingKey);
    if (!binding) return;
    const container = this.getViewContainer(binding.view);
    if (!container) return;

    if (binding.guardContainer === container) return;
    if (binding.guardContainer) {
      this.removeInputGuard(bindingKey);
    }

    const events = ['beforeinput', 'keydown', 'paste', 'drop', 'compositionstart'];
    for (const type of events) {
      container.addEventListener(type, binding.guardHandler, true);
    }
    binding.guardContainer = container;
  }

  private removeInputGuard(bindingKey: string): void {
    const binding = this.views.get(bindingKey);
    if (!binding || !binding.guardContainer) return;
    const events = ['beforeinput', 'keydown', 'paste', 'drop', 'compositionstart'];
    for (const type of events) {
      binding.guardContainer.removeEventListener(type, binding.guardHandler, true);
    }
    binding.guardContainer = null;
  }

  private setLoadingState(bindingKey: string, loading: boolean): void {
    const binding = this.views.get(bindingKey);
    if (!binding) return;
    binding.loading = loading;
    this.ensureLoadingOverlay(bindingKey);
  }

  private scheduleEditorPoll(bindingKey: string): void {
    const binding = this.views.get(bindingKey);
    if (!binding || this.destroyed || binding.editorPollTimer) return;
    binding.editorPollTimer = setTimeout(() => {
      const latest = this.views.get(bindingKey);
      if (latest) {
        latest.editorPollTimer = null;
      }
      if (this.destroyed) return;
      this.activateView(bindingKey);
    }, 120);
  }

  private updateAwarenessUser(): void {
    if (!this.provider) return;
    const color = resolveUserColor(this.user.id, this.cursorColor);
    this.provider.awareness.setLocalStateField('user', {
      id: this.user.id,
      name: this.user.username,
      avatarUrl: this.user.avatarUrl,
      color,
      colorLight: toCursorHighlight(color),
    });
  }

  private getRemoteUsersByName(): Map<string, any> {
    const usersByName = new Map<string, any>();
    const provider = this.provider;
    if (!provider) return usersByName;

    provider.awareness.getStates().forEach((state: any, clientId: number) => {
      if (clientId === provider.awareness.clientID) return;
      const remote = state?.user;
      if (!remote?.name) return;
      usersByName.set(remote.name, remote);
    });

    return usersByName;
  }

  private applyCursorUi(bindingKey: string): void {
    const binding = this.views.get(bindingKey);
    if (!binding) return;
    const cm = this.getEditorView(binding.view);
    if (!cm) return;

    const usersByName = this.getRemoteUsersByName();
    const carets = cm.dom.querySelectorAll('.cm-ySelectionCaret');
    carets.forEach((caretNode) => {
      const caret = caretNode as HTMLElement;
      const info = caret.querySelector('.cm-ySelectionInfo') as HTMLElement | null;
      if (!info) return;

      const existingName = info.dataset.hiveName;
      const currentText = (info.textContent ?? '').trim();
      const name = existingName ?? currentText;
      if (!name) return;
      info.dataset.hiveName = name;

      const remote = usersByName.get(name);
      const useProfile = Boolean(this.useProfileForCursor && remote?.avatarUrl);

      if (!useProfile) {
        caret.classList.remove('hive-caret-uses-profile');
        info.classList.remove('hive-caret-profile-info');
        info.style.removeProperty('--hive-caret-color');
        info.setAttribute('aria-label', name);
        const img = info.querySelector('.hive-caret-profile-image');
        if (img) img.remove();
        if (currentText !== name) {
          info.textContent = name;
        }
        info.style.color = labelTextColor(remote?.color ?? '#888888');
        return;
      }

      caret.classList.add('hive-caret-uses-profile');
      info.classList.add('hive-caret-profile-info');
      info.style.setProperty('--hive-caret-color', remote.color ?? '#ffffff');
      info.setAttribute('aria-label', name);
      if (info.textContent) {
        info.textContent = '';
      }

      let img = info.querySelector('.hive-caret-profile-image') as HTMLImageElement | null;
      if (!img) {
        img = document.createElement('img');
        img.className = 'hive-caret-profile-image';
        info.appendChild(img);
      }
      if (img.src !== remote.avatarUrl) {
        img.src = remote.avatarUrl;
      }
      img.alt = name;
    });
  }

  private applyCursorUiToAllViews(): void {
    for (const [bindingKey] of this.views) {
      this.applyCursorUi(bindingKey);
    }
  }

  private installCaretObserver(bindingKey: string): void {
    const binding = this.views.get(bindingKey);
    if (!binding) return;
    const cm = this.getEditorView(binding.view);
    if (!cm) {
      this.scheduleEditorPoll(bindingKey);
      return;
    }

    if (binding.caretObserver && binding.caretObserverTarget === cm.dom) {
      this.applyCursorUi(bindingKey);
      return;
    }

    if (binding.caretObserver) {
      binding.caretObserver.disconnect();
      binding.caretObserver = null;
      binding.caretObserverTarget = null;
    }

    const observer = new MutationObserver(() => {
      this.applyCursorUi(bindingKey);
    });
    observer.observe(cm.dom, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    binding.caretObserver = observer;
    binding.caretObserverTarget = cm.dom;
    this.applyCursorUi(bindingKey);
  }

  private removeCaretObserver(bindingKey: string): void {
    const binding = this.views.get(bindingKey);
    if (!binding || !binding.caretObserver) return;
    binding.caretObserver.disconnect();
    binding.caretObserver = null;
    binding.caretObserverTarget = null;
  }

  private updateEditorBanner(bindingKey: string): void {
    const binding = this.views.get(bindingKey);
    if (!binding?.bannerEl) return;

    const banner = binding.bannerEl;
    if (banner.classList.contains('is-dismissed')) return;

    const remoteUsers = this.getRemoteUsersByName();
    const avatarsEl = banner.querySelector('.hive-active-editors-avatars') as HTMLElement | null;
    if (!avatarsEl) return;

    // Clear and rebuild avatars
    while (avatarsEl.firstChild) avatarsEl.removeChild(avatarsEl.firstChild);

    if (remoteUsers.size === 0) {
      banner.classList.remove('is-visible');
      return;
    }

    for (const [, remote] of remoteUsers) {
      if (remote.avatarUrl) {
        const img = document.createElement('img');
        img.className = 'hive-active-editors-avatar';
        img.src = remote.avatarUrl;
        img.title = `@${remote.name}`;
        img.style.borderColor = remote.color ?? '';
        img.onerror = () => {
          const fb = buildAvatarFallback(remote.name, remote.color);
          img.replaceWith(fb);
        };
        avatarsEl.appendChild(img);
      } else {
        avatarsEl.appendChild(buildAvatarFallback(remote.name, remote.color));
      }
    }

    banner.classList.add('is-visible');
  }

  private updateScrollbarMarkers(bindingKey: string): void {
    const binding = this.views.get(bindingKey);
    if (!binding) return;

    const cm = this.getEditorView(binding.view);
    if (!cm) return;

    // Ensure markers overlay exists and is attached to cm.dom
    if (!binding.markersEl || !binding.markersEl.isConnected) {
      const markers = document.createElement('div');
      markers.className = 'hive-scrollbar-markers';
      cm.dom.appendChild(markers);
      binding.markersEl = markers;
    }

    const markersEl = binding.markersEl;
    while (markersEl.firstChild) markersEl.removeChild(markersEl.firstChild);

    if (!this.provider || !this.ydoc) return;

    this.provider.awareness.getStates().forEach((state: any, clientId: number) => {
      if (clientId === this.provider!.awareness.clientID) return;
      const cursor = state?.cursor;
      if (!cursor?.anchor) return;

      const abs = Y.createAbsolutePositionFromRelativePosition(cursor.anchor, this.ydoc!);
      if (!abs) return;

      const totalLines = cm.state.doc.lines;
      if (totalLines < 2) return;
      const line = cm.state.doc.lineAt(Math.min(abs.index, cm.state.doc.length)).number;
      const pct = ((line - 1) / (totalLines - 1)) * 100;

      const marker = document.createElement('div');
      marker.className = 'hive-scrollbar-marker';
      marker.style.top = `${pct}%`;
      const userColor = state?.user?.color ?? '#888888';
      marker.style.backgroundColor = userColor;
      markersEl.appendChild(marker);
    });
  }

  attach(): void {
    if (this.destroyed) return;
    const wsUrl = this.serverUrl
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://')
      + '/yjs';

    const roomName = encodeURIComponent(this.filePath);

    this.ydoc = new Y.Doc();
    this.provider = new WebsocketProvider(wsUrl, roomName, this.ydoc, {
      params: { token: this.token, vaultId: this.vaultId },
    });
    const provider = this.provider;
    this.yText = this.ydoc.getText('content');
    this.undoManager = new Y.UndoManager(this.yText);

    this.updateAwarenessUser();

    provider.on('status', ({ status }: { status: string }) => {
      if (this.destroyed) return;
      if (status === 'connected') return;
      this.setLive(false);
      this.setLoadingForAll(true);
      this.applyReadOnlyToAll(true);
    });

    // Wire awareness changes → typing indicator on file tree avatar chips
    const typingTimers = new Map<number, ReturnType<typeof setTimeout>>();
    provider.awareness.on('change', ({ updated }: { updated: number[] }) => {
      if (this.destroyed) return;
      const states = provider.awareness.getStates();
      for (const clientId of updated) {
        if (clientId === provider.awareness.clientID) continue;
        const state = states.get(clientId) as any;
        const discordId = state?.user?.id;
        if (!discordId) continue;

        const chip = document.querySelector(
          `.hive-avatar[data-id="${discordId}"]`
        ) as HTMLElement | null;
        if (!chip) continue;

        chip.classList.add('is-typing');
        clearTimeout(typingTimers.get(clientId));
        typingTimers.set(clientId, setTimeout(() => {
          chip.classList.remove('is-typing');
          typingTimers.delete(clientId);
        }, 2000));
      }

      this.applyCursorUiToAllViews();

      for (const [bindingKey] of this.views) {
        this.updateEditorBanner(bindingKey);
        this.updateScrollbarMarkers(bindingKey);
      }
    });

    // Keep reacting to sync transitions; do not rely on a single sync edge.
    provider.on('sync', (isSynced: boolean) => {
      if (this.destroyed) return;
      if (!isSynced) {
        this.setLive(false);
        this.setLoadingForAll(true);
        this.applyReadOnlyToAll(true);
        return;
      }
      this.setLive(true);
      this.activateAllViews();
    });

    if ((provider as any).synced) {
      this.setLive(true);
      this.activateAllViews();
    }
  }

  attachView(bindingKey: string, view: MarkdownView): void {
    if (this.destroyed) return;
    if (this.views.has(bindingKey)) return;

    this.views.set(bindingKey, {
      view,
      collabCompartment: null,
      readOnlyCompartment: null,
      collabAttached: false,
      editorPollTimer: null,
      loading: true,
      overlayEl: null,
      guardContainer: null,
      guardHandler: (evt: Event) => {
        const latest = this.views.get(bindingKey);
        if (!latest?.loading) return;
        evt.preventDefault();
        evt.stopPropagation();
      },
      caretObserver: null,
      caretObserverTarget: null,
      bannerEl: null,
      markersEl: null,
    });

    const binding = this.views.get(bindingKey)!;

    // Inject active-editors banner into the view container
    const container = this.getViewContainer(view);
    if (container) {
      const banner = document.createElement('div');
      banner.className = 'hive-active-editors-banner';

      const label = document.createElement('span');
      label.className = 'hive-active-editors-label';
      label.textContent = 'Here now';
      banner.appendChild(label);

      const avatarsEl = document.createElement('div');
      avatarsEl.className = 'hive-active-editors-avatars';
      banner.appendChild(avatarsEl);

      const dismissBtn = document.createElement('button');
      dismissBtn.className = 'hive-active-editors-dismiss';
      dismissBtn.setAttribute('aria-label', 'Dismiss');
      setIcon(dismissBtn, 'x');
      dismissBtn.addEventListener('click', () => banner.classList.add('is-dismissed'));
      banner.appendChild(dismissBtn);

      container.prepend(banner);
      binding.bannerEl = banner;
    }

    // Inject scrollbar markers overlay into the CodeMirror editor dom
    // We defer this until the CM editor is available (activateView will handle it)

    this.installInputGuard(bindingKey);
    this.setLoadingState(bindingKey, true);
    this.activateView(bindingKey);
  }

  detachView(bindingKey: string): void {
    const binding = this.views.get(bindingKey);
    if (!binding) return;

    if (binding.editorPollTimer) {
      clearTimeout(binding.editorPollTimer);
      binding.editorPollTimer = null;
    }

    try {
      this.removeInputGuard(bindingKey);
      this.removeCaretObserver(bindingKey);
      if (binding.overlayEl) {
        binding.overlayEl.remove();
        binding.overlayEl = null;
      }
      if (binding.bannerEl) {
        binding.bannerEl.remove();
        binding.bannerEl = null;
      }
      if (binding.markersEl) {
        binding.markersEl.remove();
        binding.markersEl = null;
      }
      const container = this.getViewContainer(binding.view);
      if (container) {
        container.classList.remove('hive-collab-lock');
        container.classList.remove('hive-collab-container');
      }
      const cm = this.getEditorView(binding.view);
      if (cm && binding.collabCompartment) {
        cm.dispatch({ effects: binding.collabCompartment.reconfigure([]) });
      }
      if (cm && binding.readOnlyCompartment) {
        cm.dispatch({ effects: binding.readOnlyCompartment.reconfigure([]) });
      }
    } catch {
      // View may already be detached
    }

    this.views.delete(bindingKey);
  }

  private attachExtensions(bindingKey: string): void {
    const binding = this.views.get(bindingKey);
    if (!binding || this.destroyed || binding.collabAttached) return;
    if (!this.yText || !this.provider || !this.undoManager) return;

    const cm = this.getEditorView(binding.view);
    if (!cm) {
      this.scheduleEditorPoll(bindingKey);
      return;
    }

    const yContent = this.yText.toString();
    const cmContent = cm.state.doc.toString();
    if (cmContent !== yContent) {
      suppress(this.filePath);
      cm.dispatch({
        changes: { from: 0, to: cmContent.length, insert: yContent },
      });
      setTimeout(() => unsuppress(this.filePath), 0);
    }

    binding.collabCompartment = new Compartment();

    cm.dispatch({
      effects: StateEffect.appendConfig.of(binding.collabCompartment.of([
        yCollab(this.yText, this.provider.awareness, { undoManager: this.undoManager }),
        keymap.of(yUndoManagerKeymap),
      ])),
    });
    binding.collabAttached = true;
    this.installCaretObserver(bindingKey);
    this.applyCursorUi(bindingKey);

    console.log(`[collab] Attached editor view: ${this.filePath}`);
  }

  private activateView(bindingKey: string): void {
    const binding = this.views.get(bindingKey);
    if (!binding) return;

    if (!this.live) {
      this.setLoadingState(bindingKey, true);
      this.applyReadOnly(bindingKey, true);
      return;
    }

    this.attachExtensions(bindingKey);
    if (!binding.collabAttached) {
      this.setLoadingState(bindingKey, true);
      this.applyReadOnly(bindingKey, true);
      return;
    }

    this.installCaretObserver(bindingKey);
    this.applyReadOnly(bindingKey, false);
    this.setLoadingState(bindingKey, false);
  }

  private activateAllViews(): void {
    for (const [bindingKey] of this.views) {
      this.activateView(bindingKey);
    }
  }

  private applyReadOnlyToAll(readOnly: boolean): void {
    for (const [bindingKey] of this.views) {
      this.applyReadOnly(bindingKey, readOnly);
    }
  }

  private setLoadingForAll(loading: boolean): void {
    for (const [bindingKey] of this.views) {
      this.setLoadingState(bindingKey, loading);
    }
  }

  updateLocalCursorPreferences(color: string | null, useProfileForCursor: boolean): void {
    this.cursorColor = normalizeCursorColor(color);
    this.useProfileForCursor = useProfileForCursor;
    this.updateAwarenessUser();
    this.applyCursorUiToAllViews();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.setLive(false);

    const bindingKeys = [...this.views.keys()];
    for (const bindingKey of bindingKeys) {
      this.detachView(bindingKey);
    }

    this.provider?.destroy();
    this.ydoc?.destroy();
    this.provider = null;
    this.ydoc = null;
    this.yText = null;
    this.undoManager = null;

    console.log(`[collab] Destroyed editor: ${this.filePath}`);
  }
}
