import { Vault } from 'obsidian';
import { AdapterRegistry } from '../collab/adapters/registry';
import { CollabAdapter } from '../collab/adapters/types';
import { markdownAdapter } from '../collab/adapters/markdownAdapter';
import { canvasAdapter } from '../collab/adapters/canvasAdapter';
import { metadataAdapter } from '../collab/adapters/metadataAdapter';
import { CollabEditor } from '../collabEditor';
import { CanvasCollabEditor } from '../canvasCollabEditor';
import { DiscordUser } from '../types';

export interface CollabRoom {
  attach(): void;
  attachView(bindingKey: string, view: unknown): void;
  detachView(bindingKey: string): void;
  isEmpty(): boolean;
  updateLocalCursorPreferences(color: string | null, useProfileForCursor: boolean): void;
  destroy(): void;
}

interface CollabSessionConfig {
  serverUrl: string;
  token: string | null;
  user: DiscordUser | null;
  cursorColor: string | null;
  useProfileForCursor: boolean;
}

type CollabRoomFactory = (input: {
  filePath: string;
  session: CollabSessionConfig;
  vault: Vault;
}) => CollabRoom;

export class CollabAdapterRuntime {
  private readonly registry = new AdapterRegistry();
  private readonly roomFactories = new Map<string, CollabRoomFactory>();

  constructor() {
    this.registerAdapter(markdownAdapter, ({ filePath, session }) => new CollabEditor(
      session.serverUrl,
      filePath,
      session.user,
      session.token,
      session.cursorColor,
      session.useProfileForCursor,
    ));

    this.registerAdapter(canvasAdapter, ({ filePath, session, vault }) => new CanvasCollabEditor(
      session.serverUrl,
      filePath,
      session.token,
      vault,
    ));

    this.registerAdapter(metadataAdapter);
  }

  registerAdapter(adapter: CollabAdapter<any, any>, roomFactory?: CollabRoomFactory): () => void {
    const unregisterAdapter = this.registry.register(adapter);
    if (roomFactory) {
      this.roomFactories.set(adapter.adapterId, roomFactory);
    }

    return () => {
      unregisterAdapter();
      this.roomFactories.delete(adapter.adapterId);
    };
  }

  getRegistry(): AdapterRegistry {
    return this.registry;
  }

  listAdapterDescriptors() {
    return this.registry.listDescriptors();
  }

  getAdapterForPath(path: string): CollabAdapter<any, any> | null {
    return this.registry.getByPath(path);
  }

  createRoom(path: string, session: CollabSessionConfig, vault: Vault): CollabRoom | null {
    if (!session.token || !session.user) return null;
    const adapter = this.getAdapterForPath(path);
    if (!adapter) return null;
    const factory = this.roomFactories.get(adapter.adapterId);
    if (!factory) return null;
    return factory({ filePath: path, session, vault });
  }
}
