import type { Task } from '@/domain/tasks/types';
import type { ScheduleEvent } from '@/domain/scheduling/types';

/** Use the entire Period's saved blocks, never just today's or this week's events. */
export function selectTaskPool(tasks: Task[], events: ScheduleEvent[], periodId: string): Task[] {
  const scheduled = new Set(events.filter(event => event.periodId === periodId && event.taskId).map(event => event.taskId));
  const seen = new Set<string>();
  return tasks.filter(task => {
    if (task.periodId !== periodId || ['DONE', 'CANCELLED'].includes(task.status) || scheduled.has(task.id) || seen.has(task.id)) return false;
    seen.add(task.id); return true;
  });
}
