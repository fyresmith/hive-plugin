import { AdapterDescriptor } from './adapters/types';

export interface ProtocolNegotiationRequest {
  protocolVersion: number;
  clientCapabilities: string[];
  adapters: AdapterDescriptor[];
}

export interface ProtocolNegotiationResponse {
  ok: true;
  negotiatedProtocol: number;
  serverCapabilities: string[];
  adapterCapabilities: Record<string, { version: string; capabilities: string[] }>;
}

export const CLIENT_CAPABILITIES = [
  'follow_mode',
  'activity_feed',
  'threads',
  'tasks',
  'notify_preferences',
  'adapter_negotiation',
  'presence_heartbeat',
];

export function buildProtocolHello(adapters: AdapterDescriptor[]): ProtocolNegotiationRequest {
  return {
    protocolVersion: 2,
    clientCapabilities: [...CLIENT_CAPABILITIES],
    adapters,
  };
}
