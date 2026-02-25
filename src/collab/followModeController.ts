import { FollowKind, FollowLocation, FollowState, initialFollowState, transitionFollowState } from './followStateMachine';

interface FollowModeControllerOptions {
  onStateChange?: (state: FollowState) => void;
  onJumpToLocation?: (location: FollowLocation, state: FollowState) => void;
}

export class FollowModeController {
  private state: FollowState = initialFollowState();

  constructor(private options: FollowModeControllerOptions = {}) {}

  getState(): FollowState {
    return this.state;
  }

  startFollowing(userId: string, mode: FollowKind): FollowState {
    this.state = transitionFollowState(this.state, {
      type: 'START_FOLLOW',
      userId,
      mode,
    });
    this.emitChange();
    return this.state;
  }

  stopFollowing(reason = 'manual-stop'): FollowState {
    this.state = transitionFollowState(this.state, {
      type: 'STOP_FOLLOW',
      reason,
    });
    this.emitChange();
    return this.state;
  }

  onDisconnect(): FollowState {
    this.state = transitionFollowState(this.state, { type: 'DISCONNECT' });
    this.emitChange();
    return this.state;
  }

  onReconnect(): FollowState {
    this.state = transitionFollowState(this.state, { type: 'RECONNECT' });
    this.emitChange();
    return this.state;
  }

  onTargetMissing(reason = 'target-missing'): FollowState {
    this.state = transitionFollowState(this.state, {
      type: 'TARGET_MISSING',
      reason,
    });
    this.emitChange();
    return this.state;
  }

  onTargetLocation(userId: string, location: FollowLocation): FollowState {
    if (this.state.targetUserId !== userId) {
      return this.state;
    }

    this.state = transitionFollowState(this.state, {
      type: 'TARGET_LOCATION',
      location,
    });
    this.emitChange();

    if (this.state.state === 'following_cursor' || this.state.state === 'following_viewport') {
      this.options.onJumpToLocation?.(location, this.state);
    }

    return this.state;
  }

  private emitChange(): void {
    this.options.onStateChange?.(this.state);
  }
}
