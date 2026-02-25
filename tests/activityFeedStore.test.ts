import test from 'node:test';
import assert from 'node:assert/strict';

import { ActivityFeedStore, groupActivityEvents } from '../src/collab/activityFeedStore';

test('groupActivityEvents groups same actor/type/file inside window', () => {
  const groups = groupActivityEvents([
    { eventId: '1', type: 'edit', filePath: 'Notes/a.md', actor: { id: 'u1', username: 'alice' }, ts: 2000 },
    { eventId: '2', type: 'edit', filePath: 'Notes/a.md', actor: { id: 'u1', username: 'alice' }, ts: 1500 },
    { eventId: '3', type: 'comment', filePath: 'Notes/a.md', actor: { id: 'u1', username: 'alice' }, ts: 1000 },
  ], 90_000);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].count, 2);
  assert.equal(groups[1].type, 'comment');
});

test('ActivityFeedStore filtering by file and type works', () => {
  const store = new ActivityFeedStore();
  store.upsert({ eventId: '1', type: 'edit', filePath: 'A.md', actor: null, ts: 1000 });
  store.upsert({ eventId: '2', type: 'comment', filePath: 'B.md', actor: null, ts: 2000 });

  const list = store.list({ scope: 'file', filePath: 'B.md', types: new Set(['comment']) }, 50);
  assert.equal(list.length, 1);
  assert.equal(list[0].eventId, '2');
});
