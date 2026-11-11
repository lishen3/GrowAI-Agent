import { z } from 'zod';
import { isoDateSchema } from '@/domain/tasks/dateOnly';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间必须为 HH:mm');
export const scheduleEventSchema = z.strictObject({
  id: z.string().min(1), periodId: z.string().min(1), taskId: z.string().min(1).nullable(),
  type: z.enum(['TASK', 'COURSE', 'AI_ADJUSTMENT', 'PERSONAL']), title: z.string().trim().min(1),
  categoryId: z.string().min(1).optional(),
  completed: z.boolean().optional(),
  date: isoDateSchema, startTime: time, endTime: time, source: z.enum(['USER', 'AI', 'SYSTEM']),
}).refine((e) => e.startTime < e.endTime, '结束时间必须晚于开始时间，不支持跨日')
  .refine((e) => e.type === 'COURSE' ? e.taskId === null && ['USER', 'SYSTEM'].includes(e.source)
    : e.type === 'PERSONAL' ? e.taskId === null && e.source === 'USER'
      : e.type === 'AI_ADJUSTMENT' ? e.taskId !== null && e.source === 'AI'
        : e.taskId !== null && e.source === 'USER', '排程关联/来源不一致')
  .transform(event => event.type === 'PERSONAL' ? { ...event, completed: event.completed ?? false } : event);
export type ScheduleEvent = z.infer<typeof scheduleEventSchema>;
export type ScheduleConflict = {
  eventAId: string;
  eventBId: string;
  type: 'OVERLAP';
  severity: 'WARNING';
};
export type CreateScheduleEvent = Omit<ScheduleEvent, 'id'>;
export type ScheduleEventChanges = Partial<Pick<ScheduleEvent, 'title' | 'date' | 'startTime' | 'endTime' | 'categoryId' | 'completed'>>;
export const scheduleChangesSchema = z.strictObject({
  completed: z.boolean().optional(),
  categoryId: z.string().min(1).optional(), title: z.string().trim().min(1).optional(), date: isoDateSchema.optional(),
  startTime: time.optional(), endTime: time.optional(),
}).refine((v) => Object.keys(v).length > 0, '修改不能为空');
export const scheduleRangeSchema = z.strictObject({ periodId: z.string().min(1), startDate: isoDateSchema, endDate: isoDateSchema })
  .refine((q) => q.startDate <= q.endDate, '日期范围无效');
export type ScheduleRange = z.infer<typeof scheduleRangeSchema>;
export function userScheduleEvent(value: unknown): ScheduleEvent {
  const event = scheduleEventSchema.parse(value);
  if (event.source !== 'USER') throw new Error('只允许修改用户创建的排程');
  return event;
}

/** Identical manual placements are retries; distinct times and overlapping-but-different events remain legal. */
export function sameManualPlacement(left: ScheduleEvent, right: ScheduleEvent): boolean {
  return left.periodId === right.periodId && left.taskId === right.taskId && left.type === right.type
    && left.source === right.source && left.title === right.title && left.date === right.date
    && left.startTime === right.startTime && left.endTime === right.endTime && left.categoryId === right.categoryId
    && (left.completed ?? false) === (right.completed ?? false);
}
