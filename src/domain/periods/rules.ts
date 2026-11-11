import { isIsoDate } from '@/shared/date';
import type { CreatePeriodInput, PeriodStatus } from './types';

export function validatePeriodInput(input: CreatePeriodInput): string[] {
  const errors: string[] = [];

  if (!input.name.trim()) errors.push('请输入阶段名称');
  if (!isIsoDate(input.startDate)) errors.push('开始日期格式应为 YYYY-MM-DD');
  if (!isIsoDate(input.endDate)) errors.push('结束日期格式应为 YYYY-MM-DD');
  if (isIsoDate(input.startDate) && isIsoDate(input.endDate) && input.endDate < input.startDate) {
    errors.push('结束日期不能早于开始日期');
  }

  return errors;
}

const allowedTransitions: Record<PeriodStatus, PeriodStatus[]> = {
  PLANNED: ['ACTIVE'],
  ACTIVE: ['COMPLETED'],
  COMPLETED: [],
};

export function canTransitionPeriod(from: PeriodStatus, to: PeriodStatus): boolean {
  return allowedTransitions[from].includes(to);
}
