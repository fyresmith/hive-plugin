"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActivityFeedStore = void 0;
exports.groupActivityEvents = groupActivityEvents;
function actorKey(actor) {
    if (!actor)
        return 'system';
    if (actor.id)
        return String(actor.id);
    if (actor.username)
        return String(actor.username);
    return 'system';
}
function groupActivityEvents(events, windowMs = 90000) {
    const sorted = [...events].sort((a, b) => b.ts - a.ts);
    const groups = [];
    for (const event of sorted) {
        const last = groups[groups.length - 1];
        const sameAsLast = Boolean(last
            && last.type === event.type
            && last.filePath === event.filePath
            && actorKey(last.actor) === actorKey(event.actor)
            && Math.abs(last.startedAt - event.ts) <= windowMs);
        if (!sameAsLast) {
            groups.push({
                groupId: `${event.eventId}:${groups.length}`,
                type: event.type,
                filePath: event.filePath,
                actor: event.actor,
                startedAt: event.ts,
                endedAt: event.ts,
                count: 1,
                events: [event],
            });
            continue;
        }
        last.events.push(event);
        last.count += 1;
        last.endedAt = Math.min(last.endedAt, event.ts);
        last.startedAt = Math.max(last.startedAt, event.ts);
    }
    return groups;
}
class ActivityFeedStore {
    constructor() {
        this.events = new Map();
    }
    upsert(activity) {
        this.events.set(activity.eventId, activity);
    }
    upsertMany(activities) {
        for (const activity of activities) {
            this.events.set(activity.eventId, activity);
        }
    }
    list(filter, limit = 200) {
        const out = [...this.events.values()]
            .filter((event) => {
            if (filter.scope === 'file' && filter.filePath) {
                if (event.filePath !== filter.filePath)
                    return false;
            }
            if (filter.types.size > 0 && !filter.types.has(event.type)) {
                return false;
            }
            return true;
        })
            .sort((a, b) => b.ts - a.ts)
            .slice(0, limit);
        return out;
    }
    grouped(filter, limit = 200, windowMs = 90000) {
        return groupActivityEvents(this.list(filter, limit), windowMs);
    }
}
exports.ActivityFeedStore = ActivityFeedStore;
