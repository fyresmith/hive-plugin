import { CollabAdapter, AdapterContext } from './types';

export interface MarkdownModel {
  content: string;
}

function parseMarkdown(serialized: string): MarkdownModel {
  return { content: typeof serialized === 'string' ? serialized : '' };
}

function applyChange(model: MarkdownModel, change: unknown): MarkdownModel {
  if (typeof change === 'string') {
    return { content: change };
  }
  if (change && typeof change === 'object' && typeof (change as any).content === 'string') {
    return { content: (change as any).content };
  }
  return model;
}

export const markdownAdapter: CollabAdapter<MarkdownModel, unknown> = {
  adapterId: 'markdown',
  version: '1.0.0',
  capabilities: ['yjs_text', 'awareness', 'cas'],
  supportsPath(path: string): boolean {
    return path.toLowerCase().endsWith('.md');
  },
  parse(serialized: string): MarkdownModel {
    return parseMarkdown(serialized);
  },
  serialize(model: MarkdownModel): string {
    return model.content;
  },
  applyLocal(model: MarkdownModel, change: unknown): MarkdownModel {
    return applyChange(model, change);
  },
  applyRemote(model: MarkdownModel, change: unknown): MarkdownModel {
    return applyChange(model, change);
  },
  merge(base: MarkdownModel, incoming: MarkdownModel): MarkdownModel {
    return incoming;
  },
  validate(value: unknown, _context: AdapterContext): boolean {
    return typeof value === 'string' || (typeof value === 'object' && value !== null);
  },
  supports(featureFlag: string): boolean {
    return this.capabilities.includes(featureFlag);
  },
};
