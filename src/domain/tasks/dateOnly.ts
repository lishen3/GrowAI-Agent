import { z } from 'zod';
import { PLANNING_CATEGORIES, GOAL_PRIORITIES } from '@/domain/goals/planningTypes';
import { isIsoDate } from '@/shared/date';
import { TASK_STATUSES, type Task } from './types';

export const isoDateSchema = z.string().refine(isIsoDate, '日期必须为 YYYY-MM-DD');
export const taskSnapshotSchema = z.strictObject({
  id: z.string().min(1), periodId: z.string().min(1), periodGoalId: z.string().nullable(),
  weeklyGoalId: z.string().nullable(), title: z.string().min(1), description: z.string().nullable(),
  category: z.enum(PLANNING_CATEGORIES), categoryId: z.string().min(1).optional(), priority: z.enum(GOAL_PRIORITIES), status: z.enum(TASK_STATUSES),
  plannedDate: isoDateSchema.nullable(), estimatedMinutes: z.number().int().nonnegative().nullable(),
  deadline: z.string().nullable(), createdAt: z.string(), startedAt: z.string().nullable(), completedAt: z.string().nullable(),
});
export const dateOnlyUpdateSchema = z.strictObject({
  taskId: z.string().min(1), targetDate: isoDateSchema, expectedBefore: taskSnapshotSchema,
});
export type DateOnlyUpdateInput = z.infer<typeof dateOnlyUpdateSchema>;

export class DateOnlyRejectedError extends Error {}

export function sameTask(left: Task, right: Task): boolean {
  return (Object.keys(taskSnapshotSchema.shape) as (keyof Task)[]).every((key) => left[key] === right[key]);
}

export function assertDateOnlyBefore(task: Task | null, input: DateOnlyUpdateInput): asserts task is Task {
  if (!task) throw new DateOnlyRejectedError('TASK_NOT_FOUND');
  taskSnapshotSchema.parse(task);
  if (task.id !== input.taskId || !sameTask(task, input.expectedBefore)) throw new DateOnlyRejectedError('BEFORE_MISMATCH');
  if (task.status !== 'TODO' && task.status !== 'DELAYED') throw new DateOnlyRejectedError('TASK_STATUS_NOT_ALLOWED');
  if (task.plannedDate === input.targetDate) throw new DateOnlyRejectedError('NO_OP');
}
