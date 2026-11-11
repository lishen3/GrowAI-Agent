import type { GrowthStore } from '@/application/data/GrowthStore';
import type { DatabaseLike } from '../types';
import { createTask, getTask } from './taskRepository';
import { scheduleEventSchema } from '@/domain/scheduling/types';
type Handle = Pick<DatabaseLike, 'getFirstAsync' | 'getAllAsync' | 'runAsync' | 'execAsync'>;
type Exclusive = { withExclusiveTransactionAsync?: (work: (tx: Handle) => Promise<void>) => Promise<void> };
export function createSQLitePersonalConversion(db: Exclusive): NonNullable<GrowthStore['convertPersonalEvent']> {
  return async (expected, input) => {
    expected = scheduleEventSchema.parse(expected);
    if (!db.withExclusiveTransactionAsync) throw new Error('独立事务不可用，原安排保持不变');
    let result!: Awaited<ReturnType<NonNullable<GrowthStore['convertPersonalEvent']>>>;
    await db.withExclusiveTransactionAsync(async tx => {
      const row = await tx.getFirstAsync<{ record_json: string }>('SELECT record_json FROM schedule_event WHERE id = ? AND period_id = ?', expected.id, expected.periodId);
      const event = row ? scheduleEventSchema.parse(JSON.parse(row.record_json)) : null;
      const taskId = 'personal_task:' + expected.id;
      const existing = await getTask(tx, taskId);
      if (event?.type === 'TASK' && event.taskId === taskId && existing && existing.periodId === expected.periodId) { result = { event, task: existing }; return; }
      if (!event || expected.type !== 'PERSONAL' || event.type !== 'PERSONAL' || event.taskId !== null || event.source !== 'USER'
        || (Object.keys(expected) as (keyof typeof expected)[]).some(key => event[key] !== expected[key]) || existing) throw new Error('原安排已变化');
      const period = await tx.getFirstAsync<{ start_date: string; end_date: string }>(
        'SELECT start_date,end_date FROM period WHERE id = ?', event.periodId);
      if (!period || input.periodId !== event.periodId || input.plannedDate !== event.date
        || event.date < period.start_date || event.date > period.end_date) throw new Error('转换范围无效');
      const task = await createTask(tx, { ...input, ...(event.categoryId ? { categoryId: event.categoryId } : {}) }, taskId);
      const after = scheduleEventSchema.parse({ ...event, type: 'TASK', taskId, title: task.title });
      await tx.runAsync('UPDATE schedule_event SET task_id = ?, record_json = ? WHERE id = ? AND period_id = ?',
        task.id, JSON.stringify(after), event.id, event.periodId);
      const saved = await tx.getFirstAsync<{ record_json: string }>('SELECT record_json FROM schedule_event WHERE id = ? AND period_id = ?', event.id, event.periodId);
      if (!saved || saved.record_json !== JSON.stringify(after)) throw new Error('转换读回失败');
      result = { task, event: after };
    });
    return result;
  };
}
