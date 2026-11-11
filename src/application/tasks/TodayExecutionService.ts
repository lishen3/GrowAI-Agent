import type { GrowthStore } from '@/application/data/GrowthStore';
import { ScheduleEventApplicationService } from '@/application/scheduling/ScheduleEventApplicationService';
import type { Achievement } from '@/domain/tasks/types';
import { isIsoDate, todayIso } from '@/shared/date';

export type TodayPersonalEvent = { id: string; title: string; startTime: string; endTime: string; completed: boolean };

export class TodayExecutionService {
  constructor(private readonly store: GrowthStore) {}

  async listPersonalEvents(periodId: string, date: string): Promise<TodayPersonalEvent[]> {
    if (!isIsoDate(date)) throw new Error('今日日期无效');
    const journey = await this.store.getJourney();
    if (!journey || !(await this.store.listPeriods(journey.id)).some(p => p.id === periodId)) throw new Error('今日阶段不存在或不属于当前旅程');
    if (!this.store.scheduleEvents) throw new Error('当前数据源不支持排程读取');
    const events = await this.store.scheduleEvents.queryByDateRange({ periodId, startDate: date, endDate: date });
    return events.filter(e => e.periodId === periodId && e.date === date && e.type === 'PERSONAL' && e.taskId === null && e.source === 'USER')
      .map(e => ({ id: e.id, title: e.title, startTime: e.startTime, endTime: e.endTime, completed: e.completed ?? false }));
  }

  async listTasks(periodId: string, date: string) {
    if (!isIsoDate(date)) throw new Error('今日日期无效');
    if (!this.store.scheduleEvents) throw new Error('当前数据源不支持排程读取');
    const schedules = new ScheduleEventApplicationService(this.store.scheduleEvents, this.store, this.store.courses);
    const journey = await this.store.getJourney();
    const period = journey && (await this.store.listPeriods(journey.id)).find(item => item.id === periodId);
    if (!period) throw new Error('今日阶段不存在或不属于当前旅程');
    const [tasks, events] = await Promise.all([
      this.store.listTasks({ periodId }),
      schedules.queryByDateRange({ periodId, startDate: date, endDate: date }),
    ]);
    const scheduled = new Set(events.filter(event => event.periodId === periodId && event.date === date
      && event.type === 'TASK' && event.taskId !== null).map(event => event.taskId));
    return [...new Map(tasks.filter(task => task.periodId === periodId && scheduled.has(task.id)
      && task.status !== 'CANCELLED').map(task => [task.id, task])).values()];
  }
}

export function selectTodayAchievements(records: Achievement[], journeyId: string, periodId: string, date: string) {
  return [...new Map(records.filter(record => record.journeyId === journeyId && record.periodId === periodId
    && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(record.occurredAt)
    && Number.isFinite(Date.parse(record.occurredAt)) && todayIso(new Date(record.occurredAt)) === date)
    .map(record => [record.id, record])).values()];
}
