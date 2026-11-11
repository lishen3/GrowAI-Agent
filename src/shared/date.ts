import { addDays, addWeeks, differenceInCalendarWeeks, parseISO, startOfWeek } from 'date-fns';

export function todayIso(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseISO(value);
  return !Number.isNaN(parsed.getTime()) && todayIso(parsed) === value;
}

export function calculatePeriodWeek(
  startDate: string,
  endDate: string,
  currentDate: string,
  weekStartsOn: 1 | 7 = 1,
): number {
  if (currentDate <= startDate) return 1;

  const boundedDate = currentDate > endDate ? endDate : currentDate;
  const weekStartsOnIndex = weekStartsOn === 1 ? 1 : 0;
  const start = startOfWeek(parseISO(startDate), { weekStartsOn: weekStartsOnIndex });
  const current = startOfWeek(parseISO(boundedDate), { weekStartsOn: weekStartsOnIndex });

  return Math.max(1, differenceInCalendarWeeks(current, start, { weekStartsOn: weekStartsOnIndex }) + 1);
}

export function getPeriodWeekRange(
  startDate: string,
  endDate: string,
  weekIndex: number,
  weekStartsOn: 1 | 7 = 1,
): { startDate: string; endDate: string } {
  if (!Number.isInteger(weekIndex) || weekIndex < 1) throw new Error('周次必须是正整数');
  const weekStartsOnIndex = weekStartsOn === 1 ? 1 : 0;
  const periodStart = parseISO(startDate);
  const rawStart = addWeeks(startOfWeek(periodStart, { weekStartsOn: weekStartsOnIndex }), weekIndex - 1);
  const rawEnd = addDays(rawStart, 6);
  return {
    startDate: rawStart < periodStart ? startDate : todayIso(rawStart),
    endDate: todayIso(rawEnd) > endDate ? endDate : todayIso(rawEnd),
  };
}

export function formatChineseDate(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date);
}
