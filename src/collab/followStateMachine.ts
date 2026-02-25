export type FollowKind = 'cursor' | 'viewport';

export type FollowModeState =
  | 'off'
  | 'pending_target'
  | 'following_cursor'
  | 'following_viewport'
  | 'suspended_target_missing';

export interface FollowLocation {
  activeFile: string | null;
  cursor?: {
    line: number;
    ch: number;
  } | null;
  viewport?: {
    x: number;
    y: number;
    zoom?: number;
  } | null;
}

export interface FollowState {
  state: FollowModeState;
  targetUserId: string | null;
  mode: FollowKind;
  location: FollowLocation | null;
  reason: string | null;
}

export type FollowAction =
  | { type: 'START_FOLLOW'; userId: string; mode: FollowKind }
  | { type: 'TARGET_LOCATION'; location: FollowLocation }
  | { type: 'TARGET_MISSING'; reason?: string }
  | { type: 'STOP_FOLLOW'; reason?: string }
  | { type: 'DISCONNECT' }
  | { type: 'RECONNECT' };

export function initialFollowState(): FollowState {
  return {
    state: 'off',
    targetUserId: null,
    mode: 'cursor',
    location: null,
    reason: null,
  };
}

function stateForMode(mode: FollowKind): FollowModeState {
  return mode === 'cursor' ? 'following_cursor' : 'following_viewport';
}

export function transitionFollowState(prev: FollowState, action: FollowAction): FollowState {
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
    if (!prev.targetUserId) return initialFollowState();
    return {
      ...prev,
      state: 'pending_target',
      reason: null,
    };
  }

  if (action.type === 'TARGET_LOCATION') {
    if (!prev.targetUserId) return prev;
    return {
      ...prev,
      state: stateForMode(prev.mode),
      location: action.location,
      reason: null,
    };
  }

  if (action.type === 'TARGET_MISSING') {
    if (!prev.targetUserId) return prev;
    return {
      ...prev,
      state: 'suspended_target_missing',
      reason: action.reason ?? 'target missing',
    };
  }

  return prev;
}
