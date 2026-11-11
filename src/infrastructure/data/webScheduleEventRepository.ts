import { projectCoursesForWeek } from '@/domain/courses/projectCourseWeek';
import type { ScheduleEventRepository } from '@/application/scheduling/ScheduleEventApplicationService';
import { scheduleChangesSchema, scheduleRangeSchema, userScheduleEvent, scheduleEventSchema, type ScheduleEvent } from '@/domain/scheduling/types';
import { createId, requestRecordId } from '@/shared/id';
import { sameManualPlacement } from '@/domain/scheduling/types';
import { requireWebCategory } from './webCategoryRepository';
import { beginBusinessWrite } from './webLifecycle';

function read<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}

function sameEvent(left: ScheduleEvent, right: ScheduleEvent): boolean {
  return left.id === right.id && left.periodId === right.periodId && left.taskId === right.taskId
    && left.type === right.type && left.title === right.title && left.date === right.date
    && left.startTime === right.startTime && left.endTime === right.endTime && left.source === right.source && left.categoryId === right.categoryId;
}
export function createWebScheduleEventRepository(db: IDBDatabase): ScheduleEventRepository {
  async function write<T>(work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const tx = await beginBusinessWrite(db, ['scheduleEvents', 'tasks', 'periods', 'categories', 'courses']);
    const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('排程事务失败')); });
    try { const result = await work(tx); await done; return result; }
    catch (e) { try { tx.abort(); } catch { /* already closed */ } await done.catch(() => undefined); throw e; }
  }
  async function check(tx: IDBTransaction, event: ScheduleEvent) {
    const period = await read(tx.objectStore('periods').get(event.periodId));
    if (!period || event.date < period.startDate || event.date > period.endDate) throw new Error('排程日期不属于阶段');
    if (event.categoryId) {
      const before = await read(tx.objectStore('scheduleEvents').get(event.id));
      await requireWebCategory(tx, period.journeyId, event.categoryId, before?.categoryId === event.categoryId);
    }
    if (event.taskId !== null) {
      const task = await read(tx.objectStore('tasks').get(event.taskId));
      if (!task || task.periodId !== event.periodId) throw new Error('排程任务不存在或跨阶段');
    }
  }
  return {
    create(input, requestId) {
      const event = userScheduleEvent({ ...input, id: requestId ? requestRecordId('schedule', requestId) : createId('schedule') });
      return write(async (tx) => {
        const events = tx.objectStore('scheduleEvents');
        const existing = await read(events.get(event.id));
        if (existing) {
          if (!sameManualPlacement(scheduleEventSchema.parse(existing), event)) throw new Error('CREATION_REQUEST_CHANGED');
          return scheduleEventSchema.parse(existing);
        }
        await check(tx, event);
        const rows = await read(events.index('periodDate').getAll([event.periodId, event.date]));
        const duplicate = rows.map(row => scheduleEventSchema.parse(row)).find(row => sameManualPlacement(row, event));
        if (duplicate) return duplicate;
        await read(events.add(event)); return event;
      });
    },
    update(periodId, id, changes) {
      const parsed = scheduleChangesSchema.parse(changes);
      return write(async (tx) => {
        const store = tx.objectStore('scheduleEvents');
        const before = await read(store.get(id));
        if (!before || before.periodId !== periodId) throw new Error('排程不存在');
        if (parsed.completed !== undefined && before.type !== 'PERSONAL') throw new Error('只有个人安排可更新完成状态');
        const event = userScheduleEvent({ ...before, ...parsed });
        await check(tx, event); await read(store.put(event)); return event;
      });
    },
    updateTimeBlock(periodId, id, expected, changes) {
      const parsed = scheduleChangesSchema.parse(changes);
      return write(async (tx) => {
        const store = tx.objectStore('scheduleEvents');
        const before = await read(store.get(id));
        if (!before || before.periodId !== periodId) throw new Error('排程不存在');
        if (!sameEvent(before, expected)) throw new Error('时间块已变化，请重新生成建议');
        const proposed = userScheduleEvent({ ...before, ...parsed });
        const period = await read(tx.objectStore('periods').get(periodId));
        if (!period) throw new Error('阶段不存在');
        const courses = await read(tx.objectStore('courses').getAll());
        const fixed = projectCoursesForWeek(courses.filter(c=>c.periodId===periodId),proposed.date,proposed.date,{periodStart:period.startDate,weekStartsOn:period.weekStartsOn});
        const rows = await read(store.getAll()) as ScheduleEvent[];
        if([...rows.filter(row=>row.periodId===periodId),...fixed].some(row=>row.id!==id && row.date===proposed.date && row.startTime<proposed.endTime && proposed.startTime<row.endTime))throw new Error('时间冲突，原位置已保留');
        const event = userScheduleEvent({ ...before, ...parsed });
        await check(tx, event); await read(store.put(event)); return event;
      });
    },
    delete(periodId, id) {
      return write(async (tx) => {
        const store = tx.objectStore('scheduleEvents'); const before = await read(store.get(id));
        if (!before || before.periodId !== periodId) throw new Error('排程不存在');
        userScheduleEvent(before); await read(store.delete(id));
      });
    },
    async queryByDateRange(range) {
      const q = scheduleRangeSchema.parse(range);
      const tx = db.transaction('scheduleEvents', 'readonly');
      const rows = await read(tx.objectStore('scheduleEvents').index('periodDate').getAll(IDBKeyRange.bound([q.periodId, q.startDate], [q.periodId, q.endDate])));
      return rows.map((r) => scheduleEventSchema.parse(r)).sort((a, b) => `${a.date}${a.startTime}${a.id}`.localeCompare(`${b.date}${b.startTime}${b.id}`));
    },
  };
}
