import type { GrowthStore } from '@/application/data/GrowthStore';
import type { Task } from '@/domain/tasks/types';
import { validateCreateTask } from '@/domain/tasks/rules';
import { scheduleEventSchema } from '@/domain/scheduling/types';
import { requireWebCategory } from './webCategoryRepository';
import { legacyCategoryForId } from '@/domain/categories/types';
import { beginBusinessWrite } from './webLifecycle';

const read = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
});
export function createWebPersonalConversion(db: IDBDatabase): NonNullable<GrowthStore['convertPersonalEvent']> {
  return async (expected, input) => {
    expected = scheduleEventSchema.parse(expected);
    validateCreateTask(input);
    const tx = await beginBusinessWrite(db, ['journeys', 'periods', 'tasks', 'scheduleEvents', 'periodGoals', 'weeklyGoals', 'goals', 'categories']);
    const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('转换事务回滚')); });
    try {
      const event = await read(tx.objectStore('scheduleEvents').get(expected.id));
      const taskId = 'personal_task:' + expected.id;
      const existing = await read(tx.objectStore('tasks').get(taskId)) as Task | undefined;
      if (event?.type === 'TASK' && event.taskId === taskId && existing && existing.periodId === expected.periodId) {
        await done; return { event, task: existing }; // Retry only returns the already committed identity.
      }
      if (!event || expected.type !== 'PERSONAL' || event.type !== 'PERSONAL' || event.source !== 'USER' || event.taskId !== null
        || ['id', 'periodId', 'taskId', 'type', 'source', 'title', 'date', 'startTime', 'endTime', 'categoryId'].some(key => event[key] !== expected[key as keyof typeof expected])
        || existing) throw new Error('原安排已变化，请重新读取');
      const period = await read(tx.objectStore('periods').get(event.periodId));
      const journeys = await read(tx.objectStore('journeys').getAll());
      if (!period || !journeys.some(j => j.id === period.journeyId) || input.periodId !== period.id || input.plannedDate !== event.date
        || event.date < period.startDate || event.date > period.endDate) throw new Error('转换范围无效');
      if (event.categoryId) await requireWebCategory(tx, period.journeyId, event.categoryId);
      const pg = input.periodGoalId ? await read(tx.objectStore('periodGoals').get(input.periodGoalId)) : null;
      const wg = input.weeklyGoalId ? await read(tx.objectStore('weeklyGoals').get(input.weeklyGoalId)) : null;
      if (input.periodGoalId && pg?.periodId !== period.id || input.weeklyGoalId && (wg?.periodId !== period.id || !pg || wg.periodGoalId !== pg.id)) throw new Error('目标关联无效');
      if (pg?.longTermGoalId) {
        const root = await read(tx.objectStore('goals').get(pg.longTermGoalId));
        if (root?.journeyId !== period.journeyId) throw new Error('长期目标归属无效');
      }
      const task: Task = { ...(event.categoryId ? { categoryId: event.categoryId } : {}), id: taskId, periodId: period.id, periodGoalId: input.periodGoalId ?? null, weeklyGoalId: input.weeklyGoalId ?? null,
        title: input.title.trim(), description: input.description?.trim() || null, category: event.categoryId ? legacyCategoryForId(event.categoryId) : input.category, priority: input.priority,
        status: 'TODO', plannedDate: event.date, estimatedMinutes: input.estimatedMinutes ?? null, deadline: input.deadline ?? null,
        createdAt: new Date().toISOString(), startedAt: null, completedAt: null };
      const after = scheduleEventSchema.parse({ ...event, type: 'TASK', taskId, title: task.title });
      await read(tx.objectStore('tasks').add(task));
      await read(tx.objectStore('scheduleEvents').put(after));
      await done; return { task, event: after };
    } catch (error) { try { tx.abort(); } catch {} await done.catch(() => undefined); throw error; }
  };
}
