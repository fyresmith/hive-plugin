import { CollabAdapter, AdapterContext } from './types';
import { isMetadataAllowedPath, parseMetadataJson } from './metadataPolicy';

export type MetadataModel = Record<string, unknown>;

export const metadataAdapter: CollabAdapter<MetadataModel, MetadataModel> = {
  adapterId: 'metadata',
  version: '1.0.0',
  capabilities: ['whitelist_policy', 'validation'],
  supportsPath(path: string): boolean {
    return isMetadataAllowedPath(path);
  },
  parse(serialized: string): MetadataModel {
    return parseMetadataJson(serialized) ?? {};
  },
  serialize(model: MetadataModel): string {
    return JSON.stringify(model, null, 2);
  },
  applyLocal(model: MetadataModel, change: MetadataModel): MetadataModel {
    return { ...model, ...change };
  },
  applyRemote(model: MetadataModel, change: MetadataModel): MetadataModel {
    return { ...model, ...change };
  },
  merge(base: MetadataModel, incoming: MetadataModel): MetadataModel {
    return { ...base, ...incoming };
  },
  validate(value: unknown, context: AdapterContext): boolean {
    if (!isMetadataAllowedPath(context.filePath)) return false;

    if (typeof value === 'string') {
      return parseMetadataJson(value) !== null;
    }

    return typeof value === 'object' && value !== null && !Array.isArray(value);
  },
  supports(featureFlag: string): boolean {
    return this.capabilities.includes(featureFlag);
  },
};
