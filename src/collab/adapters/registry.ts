import { AdapterDescriptor, CollabAdapter } from './types';

export class AdapterRegistry {
  private adapters = new Map<string, CollabAdapter<any, any>>();

  register(adapter: CollabAdapter<any, any>): () => void {
    this.adapters.set(adapter.adapterId, adapter);
    return () => {
      this.adapters.delete(adapter.adapterId);
    };
  }

  getById(adapterId: string): CollabAdapter<any, any> | null {
    return this.adapters.get(adapterId) ?? null;
  }

  getByPath(path: string): CollabAdapter<any, any> | null {
    for (const adapter of this.adapters.values()) {
      if (adapter.supportsPath(path)) {
        return adapter;
      }
    }
    return null;
  }

  listDescriptors(): AdapterDescriptor[] {
    return [...this.adapters.values()].map((adapter) => ({
      adapterId: adapter.adapterId,
      version: adapter.version,
      capabilities: [...adapter.capabilities],
    }));
  }

  listCapabilities(): Record<string, { version: string; capabilities: string[] }> {
    const out: Record<string, { version: string; capabilities: string[] }> = {};
    for (const adapter of this.adapters.values()) {
      out[adapter.adapterId] = {
        version: adapter.version,
        capabilities: [...adapter.capabilities],
      };
    }
    return out;
  }
}
