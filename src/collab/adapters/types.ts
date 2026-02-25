export interface AdapterContext {
  filePath: string;
  actorId?: string | null;
}

export interface CollabAdapter<Model = unknown, Change = unknown> {
  adapterId: string;
  version: string;
  capabilities: string[];
  supportsPath(path: string): boolean;
  parse(serialized: string, context: AdapterContext): Model;
  serialize(model: Model, context: AdapterContext): string;
  applyLocal(model: Model, change: Change, context: AdapterContext): Model;
  applyRemote(model: Model, change: Change, context: AdapterContext): Model;
  merge(base: Model, incoming: Model, context: AdapterContext): Model;
  validate(value: unknown, context: AdapterContext): boolean;
  supports(featureFlag: string): boolean;
}

export interface AdapterDescriptor {
  adapterId: string;
  version: string;
  capabilities: string[];
}
