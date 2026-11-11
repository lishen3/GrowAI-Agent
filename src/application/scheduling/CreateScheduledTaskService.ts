import type { GrowthStore } from '@/application/data/GrowthStore';
import { TaskApplicationService } from '@/application/tasks/TaskApplicationService';
import { ScheduleEventApplicationService } from './ScheduleEventApplicationService';
import type { CreateTaskInput, Task } from '@/domain/tasks/types';
import type { ScheduleEvent } from '@/domain/scheduling/types';
import { scheduleEventSchema } from '@/domain/scheduling/types';
import { validateCreateTask } from '@/domain/tasks/rules';
import type { Period } from '@/domain/periods/types';
import { resolveTaskGoalLinks } from '@/application/tasks/taskGoalLinks';

export type ScheduledTaskResult = { task: Task; event: ScheduleEvent | null; error: string | null };
/** Manual workflow: preserve a created Task if the independent scheduling write fails. */
export class CreateScheduledTaskService {
  constructor(private readonly store: GrowthStore) {}
  async createAtomic(periodId: string, input: Omit<CreateTaskInput, 'periodId' | 'plannedDate'>, slot: Pick<ScheduleEvent, 'date' | 'startTime' | 'endTime'>, requestId: string) {
    if (!this.store.createScheduledTaskAtomic) throw new Error('当前数据源不支持原子新建与排程');
    const taskInput = await resolveTaskGoalLinks(this.store, { ...input, periodGoalId: null, weeklyGoalId: null, periodId, plannedDate: slot.date });
    validateCreateTask(taskInput);
    const result = await this.store.createScheduledTaskAtomic(taskInput, slot, requestId);
    return { ...result, error: null };
  }
  async convertPersonalEvent(expected: ScheduleEvent, input: Omit<CreateTaskInput, 'periodId' | 'plannedDate'>) {
    if (!this.store.convertPersonalEvent) throw new Error('当前平台尚未支持安全转换，原安排保持不变');
    if (expected.type !== 'PERSONAL' || expected.source !== 'USER' || expected.taskId !== null) throw new Error('只能显式转换个人安排');
    const journey = await this.store.getJourney();
    if (!journey || !(await this.store.listPeriods(journey.id)).some(period => period.id === expected.periodId)) throw new Error('安排不属于当前旅程');
    const task = { ...input, periodGoalId: null, weeklyGoalId: null, ...(expected.categoryId ? { categoryId: expected.categoryId } : {}), periodId: expected.periodId, plannedDate: expected.date };
    validateCreateTask(task);
    return this.store.convertPersonalEvent(expected, await resolveTaskGoalLinks(this.store, task));
  }
  async createAndSchedule(periodId: string, input: Omit<CreateTaskInput, 'periodId' | 'plannedDate'>,
    slot: Pick<ScheduleEvent, 'date' | 'startTime' | 'endTime'>, requestId?: string): Promise<ScheduledTaskResult> {
    if (!this.store.scheduleEvents) throw new Error('当前数据空间不支持排程');
    const journey = await this.store.getJourney();
    const period: Period | undefined = journey && (await this.store.listPeriods(journey.id)).find(row => row.id === periodId) || undefined;
    if (!period || slot.date < period.startDate || slot.date > period.endDate) throw new Error('日期不属于当前阶段');
    const taskInput = { ...input, periodGoalId: null, weeklyGoalId: null, periodId, plannedDate: slot.date };
    validateCreateTask(taskInput);
    scheduleEventSchema.parse({ id: 'validate', periodId, taskId: 'validate', title: input.title, type: 'TASK', source: 'USER', ...(input.categoryId ? { categoryId: input.categoryId } : {}), ...slot });
    const task = await new TaskApplicationService(this.store).createTask(taskInput, requestId);
    try {
      const event = await new ScheduleEventApplicationService(this.store.scheduleEvents, this.store, this.store.courses)
        .create({ periodId, taskId: task.id, title: task.title, type: 'TASK', source: 'USER', ...(task.categoryId ? { categoryId: task.categoryId } : {}), ...slot }, requestId);
      return { task, event, error: null };
    } catch (error) {
      return { task, event: null, error: error instanceof Error ? error.message : '时间块保存失败' };
    }
  }
}
