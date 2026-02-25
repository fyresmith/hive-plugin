import { CollabAdapter, AdapterContext } from './types';
import {
  CanvasModel,
  parseCanvasModel,
  serializeCanvasModel,
  canonicalizeCanvasModel,
  mergeCanvasModels,
} from '../canvasModel';

export const canvasAdapter: CollabAdapter<CanvasModel, CanvasModel | string> = {
  adapterId: 'canvas',
  version: '2.0.0',
  capabilities: ['structured_model', 'legacy_text_bridge', 'deterministic_order'],
  supportsPath(path: string): boolean {
    return path.toLowerCase().endsWith('.canvas');
  },
  parse(serialized: string): CanvasModel {
    return parseCanvasModel(serialized);
  },
  serialize(model: CanvasModel): string {
    return serializeCanvasModel(model);
  },
  applyLocal(model: CanvasModel, change: CanvasModel | string): CanvasModel {
    const next = typeof change === 'string' ? parseCanvasModel(change) : canonicalizeCanvasModel(change);
    return mergeCanvasModels(model, next);
  },
  applyRemote(model: CanvasModel, change: CanvasModel | string): CanvasModel {
    const next = typeof change === 'string' ? parseCanvasModel(change) : canonicalizeCanvasModel(change);
    return mergeCanvasModels(model, next);
  },
  merge(base: CanvasModel, incoming: CanvasModel): CanvasModel {
    return mergeCanvasModels(base, incoming);
  },
  validate(value: unknown, _context: AdapterContext): boolean {
    if (typeof value === 'string') {
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    }
    return typeof value === 'object' && value !== null;
  },
  supports(featureFlag: string): boolean {
    return this.capabilities.includes(featureFlag);
  },
};
