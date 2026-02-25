"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const followStateMachine_1 = require("../src/collab/followStateMachine");
(0, node_test_1.default)('follow state transitions from off to following and back to off', () => {
    let state = (0, followStateMachine_1.initialFollowState)();
    state = (0, followStateMachine_1.transitionFollowState)(state, { type: 'START_FOLLOW', userId: 'u1', mode: 'cursor' });
    strict_1.default.equal(state.state, 'pending_target');
    state = (0, followStateMachine_1.transitionFollowState)(state, {
        type: 'TARGET_LOCATION',
        location: { activeFile: 'Notes/a.md', cursor: { line: 1, ch: 2 } },
    });
    strict_1.default.equal(state.state, 'following_cursor');
    state = (0, followStateMachine_1.transitionFollowState)(state, { type: 'STOP_FOLLOW' });
    strict_1.default.equal(state.state, 'off');
    strict_1.default.equal(state.targetUserId, null);
});
(0, node_test_1.default)('follow state suspends when target disappears', () => {
    let state = (0, followStateMachine_1.initialFollowState)();
    state = (0, followStateMachine_1.transitionFollowState)(state, { type: 'START_FOLLOW', userId: 'u2', mode: 'viewport' });
    state = (0, followStateMachine_1.transitionFollowState)(state, { type: 'TARGET_MISSING', reason: 'left' });
    strict_1.default.equal(state.state, 'suspended_target_missing');
    strict_1.default.equal(state.reason, 'left');
});
