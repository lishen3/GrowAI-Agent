import { z } from 'zod';
import { isoDateSchema } from '@/domain/tasks/dateOnly';

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间必须为 HH:mm');
const weekdaySchema = z.number().int().min(1, '星期值必须为 1 至 7').max(7, '星期值必须为 1 至 7');

const courseFieldsSchema = z.strictObject({
  id: z.string().min(1),
  periodId: z.string().min(1),
  name: z.string().trim().min(1, '课程名称不能为空'),
  // Optional so Course records written before the semester-import feature stay valid.
  teacher: z.string().trim().max(80).optional(),
  location: z.string().trim().max(120).optional(),
  weekday: weekdaySchema,
  startTime: timeSchema,
  endTime: timeSchema,
  validFrom: isoDateSchema,
  validUntil: isoDateSchema,
  // Semester week numbers (1-based). Empty/omitted means every week in the valid range.
  weeks: z.array(z.number().int().min(1).max(60)).max(60).optional(),
});

const courseRules = <T extends { startTime: string; endTime: string; validFrom: string; validUntil: string; weeks?: number[] }>(schema: z.ZodType<T>) => schema
  .refine((course) => course.startTime < course.endTime, '结束时间必须晚于开始时间，不支持跨日')
  .refine((course) => course.validFrom <= course.validUntil, '课程有效开始日期不能晚于结束日期')
  .refine((course) => !course.weeks || new Set(course.weeks).size === course.weeks.length, '课程周次不能重复');

export const courseSchema = courseRules(courseFieldsSchema);
export const createCourseSchema = courseRules(courseFieldsSchema.omit({ id: true }));
export const courseChangesSchema = courseFieldsSchema.omit({ id: true, periodId: true }).partial()
  .refine((changes) => Object.keys(changes).length > 0, '修改不能为空');

export type Course = z.infer<typeof courseSchema>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type CourseChanges = z.infer<typeof courseChangesSchema>;
