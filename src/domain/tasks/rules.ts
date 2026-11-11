import { categoryIdSchema } from '@/domain/categories/types';
import { isIsoDate } from '@/shared/date';
import { PLANNING_CATEGORIES } from '@/domain/goals/planningTypes';
import { updateTaskArgumentsSchema } from '@/domain/agent/actions';
import type { CompleteTaskInput, CreateTaskInput, Task } from './types';

export function validateCreateTask(input: CreateTaskInput): void {
  if (input.categoryId !== undefined) categoryIdSchema.parse(input.categoryId);
  if (!PLANNING_CATEGORIES.includes(input.category)) throw new Error('任务分类无效');
  if (!input.title.trim()) throw new Error('请输入任务名称');
  if (input.estimatedMinutes != null
    && (!Number.isInteger(input.estimatedMinutes) || input.estimatedMinutes < 0)) {
    throw new Error('预计时长必须是非负整数');
  }
  if (input.plannedDate && !isIsoDate(input.plannedDate)) throw new Error('计划日期格式应为 YYYY-MM-DD');
  if (input.deadline && Number.isNaN(Date.parse(input.deadline))) throw new Error('截止时间格式无效');
}

export function validateUpdateTask(input: unknown): void {
  updateTaskArgumentsSchema.parse(input);
}

export function assertTaskCanUpdate(task: Task): void {
  if (task.status === 'DONE' || task.status === 'CANCELLED') throw new Error('已完成或取消的任务不能修改计划');
}

export function validateCompleteTask(input: CompleteTaskInput): void {
  if (input.actualMinutes !== undefined
    && (!Number.isInteger(input.actualMinutes) || input.actualMinutes < 0)) {
    throw new Error('实际时长必须是非负整数');
  }
}

export function assertTaskCanComplete(task: Task): void {
  if (task.status === 'CANCELLED') throw new Error('已取消任务不能完成');
  if (task.status === 'DONE') throw new Error('任务已经完成');
}
