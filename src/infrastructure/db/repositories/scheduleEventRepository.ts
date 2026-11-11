import { exclusiveWrite } from '../exclusiveWrite';
import { projectCoursesForWeek } from '@/domain/courses/projectCourseWeek';
import { createSQLiteCourseRepository } from './courseRepository';
import type { DatabaseLike } from '../types';
import type { ScheduleEventRepository } from '@/application/scheduling/ScheduleEventApplicationService';
import { scheduleEventSchema, scheduleChangesSchema, scheduleRangeSchema, userScheduleEvent, type ScheduleEvent } from '@/domain/scheduling/types';
import { requireNativeCategory } from './categoryRepository';
import { createId, requestRecordId } from '@/shared/id';
import { sameManualPlacement } from '@/domain/scheduling/types';

function sameEvent(left: ScheduleEvent, right: ScheduleEvent): boolean {
  return left.id === right.id && left.periodId === right.periodId && left.taskId === right.taskId
    && left.type === right.type && left.title === right.title && left.date === right.date
    && left.startTime === right.startTime && left.endTime === right.endTime && left.source === right.source && left.categoryId === right.categoryId;
}

export function createSQLiteScheduleEventRepository(db: DatabaseLike): ScheduleEventRepository {
  async function check(event: ScheduleEvent, handle = db) {
    const period = await handle.getFirstAsync<{ start_date: string; end_date: string }>('SELECT start_date,end_date FROM period WHERE id = ?', event.periodId);
    if (!period || event.date < period.start_date || event.date > period.end_date) throw new Error('排程日期不属于阶段');
    if (event.categoryId) {
      const old = await handle.getFirstAsync<{ record_json: string }>('SELECT record_json FROM schedule_event WHERE id = ?', event.id);
      await requireNativeCategory(handle, event.periodId, event.categoryId, !!old && JSON.parse(old.record_json).categoryId === event.categoryId);
    }
    if (event.taskId !== null) {
      const task = await handle.getFirstAsync<{ period_id: string }>('SELECT period_id FROM task WHERE id = ?', event.taskId);
      if (!task || task.period_id !== event.periodId) throw new Error('排程任务不存在或跨阶段');
    }
  }
  async function get(periodId: string, id: string, handle = db) {
    const row = await handle.getFirstAsync<{ record_json: string }>('SELECT record_json FROM schedule_event WHERE period_id = ? AND id = ?', periodId, id);
    if (!row) throw new Error('排程不存在');
    return userScheduleEvent(JSON.parse(row.record_json));
  }
  return {
    async create(input, requestId) {
      let event = userScheduleEvent({ ...input, id: requestId ? requestRecordId('schedule', requestId) : createId('schedule') });
      await db.withTransactionAsync(async () => {
        const existing = await db.getFirstAsync<{ record_json: string }>('SELECT record_json FROM schedule_event WHERE id = ?', event.id);
        if (existing) {
          const saved = scheduleEventSchema.parse(JSON.parse(existing.record_json));
          if (!sameManualPlacement(saved, event)) throw new Error('CREATION_REQUEST_CHANGED');
          event = saved; return;
        }
        await check(event);
        const rows = await db.getAllAsync<{ record_json: string }>('SELECT record_json FROM schedule_event WHERE period_id = ? AND date = ?', event.periodId, event.date);
        const duplicate = rows.map(row => scheduleEventSchema.parse(JSON.parse(row.record_json))).find(row => sameManualPlacement(row, event));
        if (duplicate) { event = duplicate; return; }
        await db.runAsync('INSERT INTO schedule_event (id,period_id,task_id,date,record_json) VALUES (?,?,?,?,?)', event.id, event.periodId, event.taskId, event.date, JSON.stringify(event));
      }); return event;
    },
    async update(periodId, id, changes) {
      const parsed = scheduleChangesSchema.parse(changes); let event!: ScheduleEvent;
      await db.withTransactionAsync(async () => {
        const before = await get(periodId, id);
        if (parsed.completed !== undefined && before.type !== 'PERSONAL') throw new Error('只有个人安排可更新完成状态');
        event = userScheduleEvent({ ...before, ...parsed }); await check(event);
        await db.runAsync('UPDATE schedule_event SET date = ?, record_json = ? WHERE id = ? AND period_id = ?', event.date, JSON.stringify(event), id, periodId);
      }); return event;
    },
    async updateTimeBlock(periodId, id, expected, changes) {
      const parsed = scheduleChangesSchema.parse(changes); let event!: ScheduleEvent;
      await exclusiveWrite(db, async tx => {
        const db = tx;
        const before = await get(periodId, id, db);
        if (!sameEvent(before, expected)) throw new Error('时间块已变化，请重新生成建议');
        const proposed = userScheduleEvent({ ...before, ...parsed });
        const period = await db.getFirstAsync<{start_date:string;week_starts_on:1|7}>('SELECT start_date,week_starts_on FROM period WHERE id=?',periodId);
        if (!period) throw new Error('阶段不存在');
        const courses = await createSQLiteCourseRepository(db).list(periodId);
        const fixed = projectCoursesForWeek(courses,proposed.date,proposed.date,{periodStart:period.start_date,weekStartsOn:period.week_starts_on});
        const rows = await db.getAllAsync<{record_json:string}>('SELECT record_json FROM schedule_event WHERE period_id=? AND date=?',periodId,proposed.date);
        if([...rows.map(row=>scheduleEventSchema.parse(JSON.parse(row.record_json))),...fixed].some(row=>row.id!==id && row.startTime<proposed.endTime && proposed.startTime<row.endTime))throw new Error('时间冲突，原位置已保留');
        event = userScheduleEvent({ ...before, ...parsed }); await check(event, db);
        await db.runAsync('UPDATE schedule_event SET date = ?, record_json = ? WHERE id = ? AND period_id = ?',
          event.date, JSON.stringify(event), id, periodId);
      }); return event;
    },
    async delete(periodId, id) {
      await db.withTransactionAsync(async () => { await get(periodId, id); await db.runAsync('DELETE FROM schedule_event WHERE id = ? AND period_id = ?', id, periodId); });
    },
    async queryByDateRange(range) {
      const q = scheduleRangeSchema.parse(range);
      const rows = await db.getAllAsync<{ record_json: string }>('SELECT record_json FROM schedule_event WHERE period_id = ? AND date >= ? AND date <= ?', q.periodId, q.startDate, q.endDate);
      return rows.map((r) => scheduleEventSchema.parse(JSON.parse(r.record_json))).sort((a, b) => `${a.date}${a.startTime}${a.id}`.localeCompare(`${b.date}${b.startTime}${b.id}`));
    },
  };
}
