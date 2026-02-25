export type ActivityType =
  | 'edit'
  | 'create'
  | 'delete'
  | 'rename'
  | 'comment'
  | 'task'
  | 'restore'
  | 'presence'
  | 'external';

export interface ActivityEvent {
  eventId: string;
  type: ActivityType;
  filePath: string | null;
  actor: { id?: string | null; username?: string | null } | null;
  payload?: Record<string, unknown> | null;
  ts: number;
}

export interface GroupedActivity {
  groupId: string;
  type: ActivityType;
  filePath: string | null;
  actor: { id?: string | null; username?: string | null } | null;
  startedAt: number;
  endedAt: number;
  count: number;
  events: ActivityEvent[];
}

function actorKey(actor: ActivityEvent['actor']): string {
  if (!actor) return 'system';
  if (actor.id) return String(actor.id);
  if (actor.username) return String(actor.username);
  return 'system';
}

export function groupActivityEvents(events: ActivityEvent[], windowMs = 90_000): GroupedActivity[] {
  const sorted = [...events].sort((a, b) => b.ts - a.ts);
  const groups: GroupedActivity[] = [];

  for (const event of sorted) {
    const last = groups[groups.length - 1];
    const sameAsLast = Boolean(
      last
      && last.type === event.type
      && last.filePath === event.filePath
      && actorKey(last.actor) === actorKey(event.actor)
      && Math.abs(last.startedAt - event.ts) <= windowMs,
    );

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

export interface ActivityFilter {
  scope: 'workspace' | 'file';
  filePath: string | null;
  types: Set<ActivityType>;
}

export class ActivityFeedStore {
  private events = new Map<string, ActivityEvent>();

  upsert(activity: ActivityEvent): void {
    this.events.set(activity.eventId, activity);
  }

  upsertMany(activities: ActivityEvent[]): void {
    for (const activity of activities) {
      this.events.set(activity.eventId, activity);
    }
  }

  list(filter: ActivityFilter, limit = 200): ActivityEvent[] {
    const out = [...this.events.values()]
      .filter((event) => {
        if (filter.scope === 'file' && filter.filePath) {
          if (event.filePath !== filter.filePath) return false;
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

  grouped(filter: ActivityFilter, limit = 200, windowMs = 90_000): GroupedActivity[] {
    return groupActivityEvents(this.list(filter, limit), windowMs);
  }
}
