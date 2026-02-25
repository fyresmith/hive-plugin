"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initialFollowState = initialFollowState;
exports.transitionFollowState = transitionFollowState;
function initialFollowState() {
    return {
        state: 'off',
        targetUserId: null,
        mode: 'cursor',
        location: null,
        reason: null,
    };
}
function stateForMode(mode) {
    return mode === 'cursor' ? 'following_cursor' : 'following_viewport';
}
function transitionFollowState(prev, action) {
    if (action.type === 'STOP_FOLLOW' || action.type === 'DISCONNECT') {
        return {
            ...initialFollowState(),
            reason: action.type === 'STOP_FOLLOW' ? (action.reason ?? null) : 'disconnected',
        };
    }
    if (action.type === 'START_FOLLOW') {
        return {
            state: 'pending_target',
            targetUserId: action.userId,
            mode: action.mode,
            location: null,
            reason: null,
        };
    }
    if (action.type === 'RECONNECT') {
        if (!prev.targetUserId)
            return initialFollowState();
        return {
            ...prev,
            state: 'pending_target',
            reason: null,
        };
    }
    if (action.type === 'TARGET_LOCATION') {
        if (!prev.targetUserId)
            return prev;
        return {
            ...prev,
            state: stateForMode(prev.mode),
            location: action.location,
            reason: null,
        };
    }
    if (action.type === 'TARGET_MISSING') {
        if (!prev.targetUserId)
            return prev;
        return {
            ...prev,
            state: 'suspended_target_missing',
            reason: action.reason ?? 'target missing',
        };
    }
    return prev;
}
