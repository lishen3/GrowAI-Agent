import type { Task } from '@/domain/tasks/types';
import type { ProjectedCourseOccurrence } from '@/domain/courses/projectCourseWeek';
import type { ScheduleConflict, ScheduleEvent } from './types';

export type SchedulingEventFact =
  | { kind: 'TASK'; eventId: string; taskId: string; title: string; date: string; startTime: string; endTime: string; adjustable: boolean }
  | { kind: 'COURSE'; eventId: string; courseId: string | null; title: string; date: string; startTime: string; endTime: string; locked: true }
  | { kind: 'AI_ADJUSTMENT'; eventId: string; taskId: string; title: string; date: string; startTime: string; endTime: string; locked: true }
  | { kind: 'PERSONAL'; eventId: string; taskId: null; title: string; date: string; startTime: string; endTime: string; locked: true };

export type UnscheduledTaskFact = Pick<Task, 'id' | 'title' | 'status' | 'plannedDate' | 'estimatedMinutes' | 'categoryId'> & Partial<Pick<Task,'periodGoalId'|'weeklyGoalId'|'priority'>>;

export type SchedulingContext = {
  weekStart: string;
  weekEnd: string;
  events: SchedulingEventFact[];
  conflicts: ScheduleConflict[];
  unscheduledTasks: UnscheduledTaskFact[];
  linkedTaskFacts?: (UnscheduledTaskFact & { periodId: string })[];
};

export type WeekReadModel = {
  startDate: string;
  endDate: string;
  events: ScheduleEvent[];
  conflicts: ScheduleConflict[];
  unscheduledTasks: Task[];
};

function isProjectedCourse(event: ScheduleEvent): event is ProjectedCourseOccurrence {
  return event.type === 'COURSE' && 'courseId' in event;
}

export function buildSchedulingContext(week: WeekReadModel, tasks: Task[]): SchedulingContext {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const events: SchedulingEventFact[] = week.events.map((event) => {
    if (event.type === 'COURSE') {
      return {
        kind: 'COURSE', eventId: event.id, courseId: isProjectedCourse(event) ? event.courseId : null,
        title: event.title, date: event.date, startTime: event.startTime, endTime: event.endTime, locked: true,
      };
    }
    if (event.type === 'AI_ADJUSTMENT') {
      return { kind: 'AI_ADJUSTMENT', eventId: event.id, taskId: event.taskId!, title: event.title,
        date: event.date, startTime: event.startTime, endTime: event.endTime, locked: true };
    }
    if (event.type === 'PERSONAL') {
      return { kind: 'PERSONAL', eventId: event.id, taskId: null, title: event.title,
        date: event.date, startTime: event.startTime, endTime: event.endTime, locked: true };
    }
    const task = taskById.get(event.taskId!);
    return { kind: 'TASK', eventId: event.id, taskId: event.taskId!, title: task?.title ?? event.title,
      date: event.date, startTime: event.startTime, endTime: event.endTime,
      adjustable: event.source === 'USER' && (task?.status === 'TODO' || task?.status === 'DELAYED') };
  });

  return {
    weekStart: week.startDate,
    weekEnd: week.endDate,
    events: events.map((event,index) => ({ ...event, ...(week.events[index].categoryId ? { categoryId: week.events[index].categoryId } : {}) })),
    conflicts: week.conflicts.map((conflict) => ({ ...conflict })),
    unscheduledTasks: week.unscheduledTasks.map(({ id, title, status, plannedDate, estimatedMinutes, categoryId }) =>
      ({ id, title, status, plannedDate, estimatedMinutes, ...(categoryId ? { categoryId } : {}) })),
    ...(week.events.some(event => event.type === 'TASK' || event.type === 'AI_ADJUSTMENT') ? { linkedTaskFacts: tasks.filter(task => week.events.some(event => (event.type === 'TASK' || event.type === 'AI_ADJUSTMENT')
      && event.taskId === task.id && event.periodId === task.periodId))
      .map(({ id, periodId, title, status, plannedDate, estimatedMinutes, categoryId }) =>
        ({ id, periodId, title, status, plannedDate, estimatedMinutes, ...(categoryId ? { categoryId } : {}) })) } : {}),
  };
}
