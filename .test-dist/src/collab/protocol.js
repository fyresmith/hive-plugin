"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLIENT_CAPABILITIES = void 0;
exports.buildProtocolHello = buildProtocolHello;
exports.CLIENT_CAPABILITIES = [
    'follow_mode',
    'activity_feed',
    'threads',
    'tasks',
    'notify_preferences',
    'adapter_negotiation',
    'presence_heartbeat',
];
function buildProtocolHello(adapters) {
    return {
        protocolVersion: 2,
        clientCapabilities: [...exports.CLIENT_CAPABILITIES],
        adapters,
    };
}
