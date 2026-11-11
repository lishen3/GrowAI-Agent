import type { ReviewTaskFact, CategoryBreakdown, PlanVsReality } from './types';
import type { ScheduleEvent } from '@/domain/scheduling/types';
import type { Task, TaskExecution } from '@/domain/tasks/types';
import { todayIso } from '@/shared/date';

const unfinishedStatuses = new Set(['TODO', 'DOING', 'DELAYED']);

export function selectTasksForWindow(tasks: Task[], windowStart: string, windowEnd: string, events?: ScheduleEvent[]): Task[] {
  return [...new Map(tasks.filter(task => {
    const assigned = events?.filter(event => event.periodId === task.periodId && event.taskId === task.id
      && (event.type === 'TASK' || event.type === 'AI_ADJUSTMENT')) ?? [];
    return assigned.length ? assigned.some(event => event.date >= windowStart && event.date <= windowEnd)
      : task.plannedDate !== null && task.plannedDate >= windowStart && task.plannedDate <= windowEnd;
  }).map(task => [task.id, task])).values()];
}

export function occurredInWindow(timestamp: string, start: string, end: string): boolean {
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) return false;
  const date = todayIso(new Date(timestamp));
  return date >= start && date <= end;
}

function taskFact(task: Task): ReviewTaskFact {
  return {
    ...(task.categoryId ? { categoryId: task.categoryId } : {}), id: task.id, title: task.title, category: task.category, priority: task.priority,
    status: task.status, plannedDate: task.plannedDate, estimatedMinutes: task.estimatedMinutes,
    weeklyGoalId: task.weeklyGoalId, periodGoalId: task.periodGoalId,
  };
}

function sumKnown(values: Array<number | null>): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return (values as number[]).reduce((sum, value) => sum + value, 0);
}

export function calculatePlanVsReality(
  allTasks: Task[],
  allExecutions: TaskExecution[],
  windowStart: string,
  windowEnd: string,
  events?: ScheduleEvent[],
): PlanVsReality {
  const windowTasks = selectTasksForWindow(allTasks, windowStart, windowEnd, events);
  const cancelled = windowTasks.filter((task) => task.status === 'CANCELLED');
  const planned = windowTasks.filter((task) => task.status !== 'CANCELLED');
  const completed = planned.filter((task) => task.status === 'DONE');
  const unfinished = planned.filter((task) => unfinishedStatuses.has(task.status));
  const plannedIds = new Set(planned.map((task) => task.id));
  const executions = [...new Map(allExecutions.filter(execution => plannedIds.has(execution.taskId)
    && occurredInWindow(execution.completedAt, windowStart, windowEnd)).map(execution => [execution.id, execution])).values()];

  const categories = [...new Set(planned.map((task) => task.categoryId ?? task.category))];
  const categoryBreakdown: CategoryBreakdown[] = categories.map((category) => {
    const categoryTasks = planned.filter((task) => (task.categoryId ?? task.category) === category);
    const categoryIds = new Set(categoryTasks.map((task) => task.id));
    const categoryExecutions = executions.filter((execution) => categoryIds.has(execution.taskId));
    return {
      category: categoryTasks[0].category,
      ...(categoryTasks[0].categoryId ? { categoryId: categoryTasks[0].categoryId } : {}),
      plannedTaskCount: categoryTasks.length,
      completedTaskCount: categoryTasks.filter((task) => task.status === 'DONE').length,
      plannedMinutes: sumKnown(categoryTasks.map((task) => task.estimatedMinutes)),
      actualMinutes: sumKnown(categoryExecutions.map((execution) => execution.actualMinutes)),
    };
  });

  return {
    plannedTaskCount: planned.length,
    completedTaskCount: completed.length,
    unfinishedTaskCount: unfinished.length,
    cancelledTaskCount: cancelled.length,
    plannedMinutes: sumKnown(planned.map((task) => task.estimatedMinutes)),
    actualMinutes: sumKnown(executions.map((execution) => execution.actualMinutes)),
    completionRate: planned.length === 0 ? null : completed.length / planned.length,
    categoryBreakdown,
    unfinishedTasks: unfinished.map(taskFact),
    completedTasks: completed.map(taskFact),
  };
}
