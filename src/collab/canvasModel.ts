export interface CanvasEntity {
  id: string;
  updatedAt?: number;
  deleted?: boolean;
  [key: string]: any;
}

export interface CanvasModel {
  nodes: CanvasEntity[];
  edges: CanvasEntity[];
  [key: string]: any;
}

function normalizeEntity(entity: any): CanvasEntity | null {
  if (!entity || typeof entity !== 'object') return null;
  if (typeof entity.id !== 'string' || entity.id.length === 0) return null;

  const normalized: CanvasEntity = { ...entity };
  if (typeof normalized.updatedAt !== 'number') {
    normalized.updatedAt = 0;
  }
  normalized.deleted = Boolean(normalized.deleted);
  return normalized;
}

function normalizeEntities(input: any): CanvasEntity[] {
  if (!Array.isArray(input)) return [];
  const out: CanvasEntity[] = [];
  for (const entity of input) {
    const normalized = normalizeEntity(entity);
    if (normalized) out.push(normalized);
  }
  return out;
}

function stableEntitySort(a: CanvasEntity, b: CanvasEntity): number {
  return a.id.localeCompare(b.id);
}

export function canonicalizeCanvasModel(input: any): CanvasModel {
  const model: CanvasModel = typeof input === 'object' && input ? { ...input } : { nodes: [], edges: [] };
  model.nodes = normalizeEntities(model.nodes).sort(stableEntitySort);
  model.edges = normalizeEntities(model.edges).sort(stableEntitySort);
  return model;
}

export function parseCanvasModel(raw: string): CanvasModel {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return canonicalizeCanvasModel({ nodes: [], edges: [] });
  }

  try {
    const parsed = JSON.parse(raw);
    return canonicalizeCanvasModel(parsed);
  } catch {
    return canonicalizeCanvasModel({ nodes: [], edges: [] });
  }
}

function resolveEntity(base: CanvasEntity | null, incoming: CanvasEntity): CanvasEntity {
  if (!base) return incoming;

  // Delete wins over stale updates.
  if (incoming.deleted && !base.deleted) {
    return incoming;
  }
  if (base.deleted && !incoming.deleted) {
    const baseTs = typeof base.updatedAt === 'number' ? base.updatedAt : 0;
    const incomingTs = typeof incoming.updatedAt === 'number' ? incoming.updatedAt : 0;
    return incomingTs > baseTs ? incoming : base;
  }

  const baseTs = typeof base.updatedAt === 'number' ? base.updatedAt : 0;
  const incomingTs = typeof incoming.updatedAt === 'number' ? incoming.updatedAt : 0;
  if (incomingTs > baseTs) return incoming;
  if (incomingTs < baseTs) return base;

  // Deterministic fallback on equal timestamps.
  const baseStr = JSON.stringify(base);
  const incomingStr = JSON.stringify(incoming);
  return incomingStr.localeCompare(baseStr) >= 0 ? incoming : base;
}

function mergeEntities(base: CanvasEntity[], incoming: CanvasEntity[]): CanvasEntity[] {
  const byId = new Map<string, CanvasEntity>();

  for (const entity of base) {
    byId.set(entity.id, entity);
  }
  for (const entity of incoming) {
    const existing = byId.get(entity.id) ?? null;
    byId.set(entity.id, resolveEntity(existing, entity));
  }

  return [...byId.values()].sort(stableEntitySort);
}

export function mergeCanvasModels(baseInput: CanvasModel, incomingInput: CanvasModel): CanvasModel {
  const base = canonicalizeCanvasModel(baseInput);
  const incoming = canonicalizeCanvasModel(incomingInput);

  return {
    ...base,
    ...incoming,
    nodes: mergeEntities(base.nodes, incoming.nodes),
    edges: mergeEntities(base.edges, incoming.edges),
  };
}

export function serializeCanvasModel(input: CanvasModel): string {
  const canonical = canonicalizeCanvasModel(input);
  return JSON.stringify(canonical, null, 2);
}
