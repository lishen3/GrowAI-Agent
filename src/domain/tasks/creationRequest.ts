import type { CreateTaskInput, Task } from './types';
import { legacyCategoryForId } from '@/domain/categories/types';

export function assertSameTaskCreation(task: Task, input: CreateTaskInput): void {
  if (task.periodId !== input.periodId || task.title !== input.title.trim()
    || task.category !== (input.categoryId ? legacyCategoryForId(input.categoryId) : input.category)
    || (task.categoryId ?? task.category) !== (input.categoryId ?? input.category) || task.priority !== input.priority
    || task.description !== (input.description?.trim() || null) || task.plannedDate !== (input.plannedDate ?? null)
    || task.estimatedMinutes !== (input.estimatedMinutes ?? null) || task.deadline !== (input.deadline ?? null)
    || task.periodGoalId !== (input.periodGoalId ?? null) || task.weeklyGoalId !== (input.weeklyGoalId ?? null)) {
    throw new Error('CREATION_REQUEST_CHANGED: 创建请求或已保存任务已变化，请先查看已有记录');
  }
}
