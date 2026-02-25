"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const activityFeedStore_1 = require("../src/collab/activityFeedStore");
(0, node_test_1.default)('groupActivityEvents groups same actor/type/file inside window', () => {
    const groups = (0, activityFeedStore_1.groupActivityEvents)([
        { eventId: '1', type: 'edit', filePath: 'Notes/a.md', actor: { id: 'u1', username: 'alice' }, ts: 2000 },
        { eventId: '2', type: 'edit', filePath: 'Notes/a.md', actor: { id: 'u1', username: 'alice' }, ts: 1500 },
        { eventId: '3', type: 'comment', filePath: 'Notes/a.md', actor: { id: 'u1', username: 'alice' }, ts: 1000 },
    ], 90000);
    strict_1.default.equal(groups.length, 2);
    strict_1.default.equal(groups[0].count, 2);
    strict_1.default.equal(groups[1].type, 'comment');
});
(0, node_test_1.default)('ActivityFeedStore filtering by file and type works', () => {
    const store = new activityFeedStore_1.ActivityFeedStore();
    store.upsert({ eventId: '1', type: 'edit', filePath: 'A.md', actor: null, ts: 1000 });
    store.upsert({ eventId: '2', type: 'comment', filePath: 'B.md', actor: null, ts: 2000 });
    const list = store.list({ scope: 'file', filePath: 'B.md', types: new Set(['comment']) }, 50);
    strict_1.default.equal(list.length, 1);
    strict_1.default.equal(list[0].eventId, '2');
});
