import test from 'node:test';
import assert from 'node:assert/strict';

import { initialFollowState, transitionFollowState } from '../src/collab/followStateMachine';

test('follow state transitions from off to following and back to off', () => {
  let state = initialFollowState();
  state = transitionFollowState(state, { type: 'START_FOLLOW', userId: 'u1', mode: 'cursor' });
  assert.equal(state.state, 'pending_target');

  state = transitionFollowState(state, {
    type: 'TARGET_LOCATION',
    location: { activeFile: 'Notes/a.md', cursor: { line: 1, ch: 2 } },
  });
  assert.equal(state.state, 'following_cursor');

  state = transitionFollowState(state, { type: 'STOP_FOLLOW' });
  assert.equal(state.state, 'off');
  assert.equal(state.targetUserId, null);
});

test('follow state suspends when target disappears', () => {
  let state = initialFollowState();
  state = transitionFollowState(state, { type: 'START_FOLLOW', userId: 'u2', mode: 'viewport' });
  state = transitionFollowState(state, { type: 'TARGET_MISSING', reason: 'left' });
  assert.equal(state.state, 'suspended_target_missing');
  assert.equal(state.reason, 'left');
});
