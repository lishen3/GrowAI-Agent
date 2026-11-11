import { addDays, parseISO } from 'date-fns';
import { todayIso } from '@/shared/date';
import type { TaskGateway } from '@/application/tasks/TaskApplicationService';
import type { CourseRepository } from '@/application/courses/CourseApplicationService';
import { projectCoursesForWeek, type CourseWeekOptions } from '@/domain/courses/projectCourseWeek';
import { detectScheduleConflicts } from '@/domain/scheduling/detectScheduleConflicts';
import { scheduleRangeSchema, type CreateScheduleEvent, type ScheduleEvent, type ScheduleEventChanges, type ScheduleRange } from '@/domain/scheduling/types';
import type { Task } from '@/domain/tasks/types';

export type ScheduleTimeChanges = Pick<ScheduleEvent, 'date' | 'startTime' | 'endTime'>;

export interface ScheduleEventRepository {
  create(input: CreateScheduleEvent, requestId?: string): Promise<ScheduleEvent>;
  update(periodId: string, id: string, changes: ScheduleEventChanges): Promise<ScheduleEvent>;
  /** Conditional time-only write used after a user-approved Agent proposal. */
  updateTimeBlock?(periodId: string, id: string, expected: ScheduleEvent, changes: ScheduleTimeChanges): Promise<ScheduleEvent>;
  delete(periodId: string, id: string): Promise<void>;
  queryByDateRange(range: ScheduleRange): Promise<ScheduleEvent[]>;
}

export type WeekPlan = {
  startDate: string;
  endDate: string;
  events: ScheduleEvent[];
  unscheduledTasks: Task[];
  conflicts: ReturnType<typeof detectScheduleConflicts>;
};

export type WeekReadResult = { week: WeekPlan; tasks: Task[] };

export class ScheduleEventApplicationService {
  constructor(private readonly repository: ScheduleEventRepository, private readonly tasks: Pick<TaskGateway, 'listTasks'>,
    private readonly courses?: Pick<CourseRepository, 'list'>) {}
  create(input: CreateScheduleEvent, requestId?: string) {
    return requestId ? this.repository.create(input, requestId) : this.repository.create(input);
  }
  update(periodId: string, id: string, changes: ScheduleEventChanges) { return this.repository.update(periodId, id, changes); }
  updateTimeBlock(periodId: string, id: string, expected: ScheduleEvent, changes: ScheduleTimeChanges) {
    if (!this.repository.updateTimeBlock) throw new Error('当前数据源不支持条件时间移动');
    const { date, startTime, endTime } = changes;
    return this.repository.updateTimeBlock(periodId, id, expected, { date, startTime, endTime });
  }
  async updateCalendarTime(period: import('@/domain/periods/types').Period, before: ScheduleEvent, after: ScheduleTimeChanges) {
    if(before.periodId!==period.id || before.source!=='USER' || before.type==='COURSE')throw new Error('此时间块不可修改');
    if(after.date<period.startDate || after.date>period.endDate)throw new Error('日期超出当前阶段');
    const target=await this.queryWeek(period.id,after.date,after.date,{periodStart:period.startDate,weekStartsOn:period.weekStartsOn});
    if(target.events.some(row=>row.id!==before.id && row.startTime<after.endTime && after.startTime<row.endTime))throw new Error('时间冲突，原位置已保留');
    if(before.date===after.date && before.startTime===after.startTime && before.endTime===after.endTime)return before;
    return this.updateTimeBlock(period.id,before.id,before,after);
  }
  delete(periodId: string, id: string) { return this.repository.delete(periodId, id); }
  queryByDateRange(range: ScheduleRange) { return this.repository.queryByDateRange(scheduleRangeSchema.parse(range)); }
  async queryWeek(periodId: string, weekStart: string, weekEnd = todayIso(addDays(parseISO(weekStart), 6)),
    courseOptions: CourseWeekOptions = {}): Promise<WeekPlan> {
    return (await this.queryWeekWithTasks(periodId, weekStart, weekEnd, courseOptions)).week;
  }
  async queryWeekWithTasks(periodId: string, weekStart: string, weekEnd = todayIso(addDays(parseISO(weekStart), 6)),
    courseOptions: CourseWeekOptions = {}): Promise<WeekReadResult> {
    // Caller supplies the existing Period's actual week start; do not assume Monday or 16 weeks.
    const first = scheduleRangeSchema.parse({ periodId, startDate: weekStart, endDate: weekStart });
    const endDate = scheduleRangeSchema.parse({ ...first, endDate: weekEnd }).endDate;
    if (endDate > todayIso(addDays(parseISO(first.startDate), 6))) throw new Error('周查询不能超过七天');
    const savedEvents = await this.queryByDateRange({ ...first, endDate });
    const courses = this.courses ? await this.courses.list(periodId) : [];
    const events = [...savedEvents, ...projectCoursesForWeek(courses, weekStart, endDate, courseOptions)]
      .sort((a, b) => `${a.date}${a.startTime}${a.id}`.localeCompare(`${b.date}${b.startTime}${b.id}`));
    const conflicts = detectScheduleConflicts(events);
    const assigned = new Set(events.map((e) => e.taskId));
    const tasks = await this.tasks.listTasks({ periodId });
    const unscheduledTasks = tasks.filter((task) => !['DONE', 'CANCELLED'].includes(task.status)
      && !assigned.has(task.id) && (task.plannedDate === null || task.plannedDate >= weekStart && task.plannedDate <= endDate));
    return { week: { startDate: weekStart, endDate, events, unscheduledTasks, conflicts }, tasks };
  }
}
