"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FollowModeController = void 0;
const followStateMachine_1 = require("./followStateMachine");
class FollowModeController {
    constructor(options = {}) {
        this.options = options;
        this.state = (0, followStateMachine_1.initialFollowState)();
    }
    getState() {
        return this.state;
    }
    startFollowing(userId, mode) {
        this.state = (0, followStateMachine_1.transitionFollowState)(this.state, {
            type: 'START_FOLLOW',
            userId,
            mode,
        });
        this.emitChange();
        return this.state;
    }
    stopFollowing(reason = 'manual-stop') {
        this.state = (0, followStateMachine_1.transitionFollowState)(this.state, {
            type: 'STOP_FOLLOW',
            reason,
        });
        this.emitChange();
        return this.state;
    }
    onDisconnect() {
        this.state = (0, followStateMachine_1.transitionFollowState)(this.state, { type: 'DISCONNECT' });
        this.emitChange();
        return this.state;
    }
    onReconnect() {
        this.state = (0, followStateMachine_1.transitionFollowState)(this.state, { type: 'RECONNECT' });
        this.emitChange();
        return this.state;
    }
    onTargetMissing(reason = 'target-missing') {
        this.state = (0, followStateMachine_1.transitionFollowState)(this.state, {
            type: 'TARGET_MISSING',
            reason,
        });
        this.emitChange();
        return this.state;
    }
    onTargetLocation(userId, location) {
        if (this.state.targetUserId !== userId) {
            return this.state;
        }
        this.state = (0, followStateMachine_1.transitionFollowState)(this.state, {
            type: 'TARGET_LOCATION',
            location,
        });
        this.emitChange();
        if (this.state.state === 'following_cursor' || this.state.state === 'following_viewport') {
            this.options.onJumpToLocation?.(location, this.state);
        }
        return this.state;
    }
    emitChange() {
        this.options.onStateChange?.(this.state);
    }
}
exports.FollowModeController = FollowModeController;
