import type { ScheduleConflict, ScheduleEvent } from './types';

function overlaps(a: ScheduleEvent, b: ScheduleEvent): boolean {
  return a.date === b.date && a.startTime < b.endTime && b.startTime < a.endTime;
}

export function detectScheduleConflicts(events: ScheduleEvent[]): ScheduleConflict[] {
  const relevant = [...events]
    .filter((event) => event.type === 'TASK' || event.type === 'COURSE' || event.type === 'PERSONAL')
    .sort((a, b) => `${a.date}${a.startTime}${a.endTime}${a.id}${a.title}`
      .localeCompare(`${b.date}${b.startTime}${b.endTime}${b.id}${b.title}`));
  const conflicts = new Map<string, ScheduleConflict>();

  for (let i = 0; i < relevant.length; i++) {
    for (let j = i + 1; j < relevant.length; j++) {
      const first = relevant[i];
      const second = relevant[j];
      if (first.id === second.id || !overlaps(first, second)) continue;
      const [eventAId, eventBId] = [first.id, second.id].sort();
      const key = `${eventAId}\u0000${eventBId}`;
      conflicts.set(key, { eventAId, eventBId, type: 'OVERLAP', severity: 'WARNING' });
    }
  }

  return [...conflicts.values()].sort((a, b) => `${a.eventAId}\u0000${a.eventBId}`.localeCompare(`${b.eventAId}\u0000${b.eventBId}`));
}
