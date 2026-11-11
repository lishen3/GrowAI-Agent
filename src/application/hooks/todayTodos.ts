import type { Task, TaskExecution } from '@/domain/tasks/types';
import type { ScheduleEvent } from '@/domain/scheduling/types';
import type { TodayPersonalEvent } from '@/application/tasks/TodayExecutionService';

export type TodayTodo = { key: string; id: string; title: string; times: string[]; startTime: string | null; completed: boolean }
  & ({ kind: 'task'; task: Task } | { kind: 'personal' });

// A read-only presentation projection. Identity and write contracts stay separate.
export function combineTodayTodos(tasks: Task[], personal: TodayPersonalEvent[], events: ScheduleEvent[], date: string): TodayTodo[] {
  const rows: TodayTodo[] = tasks.filter(task => task.status !== 'CANCELLED').flatMap(task => {
    const blocks = events.filter(event => event.type === 'TASK' && event.taskId === task.id && event.periodId === task.periodId && event.date === date)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (!blocks.length) return [];
    return [{ kind: 'task' as const, key: `task:${task.id}`, id: task.id, title: task.title, task, completed: task.status === 'DONE',
      startTime: blocks[0].startTime, times: [...new Set(blocks.map(block => `${block.startTime}–${block.endTime}`))] }];
  });
  rows.push(...personal.map(event => ({ kind: 'personal' as const, key: `personal:${event.id}`, id: event.id,
    title: event.title, startTime: event.startTime, times: [`${event.startTime}–${event.endTime}`], completed: event.completed })));
  return rows.sort((a, b) => Number(a.completed) - Number(b.completed)
    || (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99') || a.key.localeCompare(b.key));
}

export function summarizeTodayTodos(items: TodayTodo[], executions: TaskExecution[], events: ScheduleEvent[], date: string, periodId: string) {
  const tasks = new Map((items || []).flatMap(item => item.kind === 'task' ? [[item.id, item.task] as const] : []));
  const records = new Map((executions || []).filter(row => tasks.get(row.taskId)?.status === 'DONE').map(row => [row.id, row]));
  const blocks = new Map((events || []).filter(event => event.date === date && event.periodId === periodId && event.type === 'TASK').map(event => [event.id, event]));
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return {
    plannedMinutes: [...blocks.values()].reduce((sum, event) => sum + minutes(event.endTime) - minutes(event.startTime), 0),
    actualMinutes: [...records.values()].reduce((sum, row) => sum + (row.actualMinutes ?? 0), 0),
  };
}
