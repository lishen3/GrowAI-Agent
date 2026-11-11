import { z } from 'zod';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { isIsoDate } from '@/shared/date';
const date = z.string().refine(isIsoDate, '日期格式应为 YYYY-MM-DD');
export const goalPlanningSchema = z.object({
  endDate: date.nullable(),
  mode: z.enum(['MANUAL', 'MILESTONE']),
  manualPercent: z.number().min(0).max(100),
  milestones: z.array(z.object({ id: z.string().min(1), title: z.string().trim().min(1), weight: z.number().positive().max(1000000), completed: z.boolean() }).strict()).max(100),
}).strict().refine(value => new Set(value.milestones.map(row => row.id)).size === value.milestones.length, '里程碑不能重复');
export type GoalPlanning = z.infer<typeof goalPlanningSchema>;
export function goalProgress(value: GoalPlanning | undefined) {
  if (!value) return null;
  const input = goalPlanningSchema.parse(value);
  if (input.mode === 'MANUAL') return { percent: input.manualPercent, source: '用户手动评估' };
  const total = input.milestones.reduce((sum, row) => sum + row.weight, 0);
  return total ? { percent: input.milestones.filter(row => row.completed).reduce((sum,row) => sum + row.weight,0) / total * 100, source: '已完成里程碑权重 / 总权重' } : null;
}
export function goalDeadline(endDate: string | null | undefined, today: string) {
  if (!endDate) return { label: '持续进行', remainingDays: null };
  if (!isIsoDate(endDate) || !isIsoDate(today)) throw new Error('日期无效');
  const days = differenceInCalendarDays(parseISO(endDate), parseISO(today));
  return { label: days < 0 ? `已逾期 ${-days} 天` : days === 0 ? '今天到期' : `剩余 ${days} 天`, remainingDays: Math.max(0, days) };
}
