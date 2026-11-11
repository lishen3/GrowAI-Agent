import { addDays, getISODay, parseISO, startOfISOWeek } from 'date-fns';
import type { Period } from '@/domain/periods/types';
import { calculatePeriodWeek, isIsoDate, todayIso } from '@/shared/date';

type StageDates = Pick<Period, 'startDate' | 'endDate'>;

function checkDates(period: StageDates) {
  if (!isIsoDate(period.startDate) || !isIsoDate(period.endDate) || period.endDate < period.startDate) {
    throw new Error('当前阶段的起止日期无效');
  }
}

export function suggestedTeachingMonday(period: StageDates): string {
  checkDates(period);
  const start = parseISO(period.startDate);
  if (getISODay(start) === 7 && period.startDate < period.endDate) return todayIso(addDays(start, 1));
  return todayIso(startOfISOWeek(start));
}

/** Course.weeks uses stage week numbers. School week 1 starts on the supplied Monday. */
export function mapCourseTeachingWeeks(
  period: Pick<Period, 'startDate' | 'endDate' | 'weekStartsOn'>,
  weekday: number,
  firstTeachingMonday: string,
  printedWeeks: readonly number[],
): { weeks: number[]; skipped: number } {
  checkDates(period);
  const monday = parseISO(firstTeachingMonday);
  if (!isIsoDate(firstTeachingMonday) || getISODay(monday) !== 1) throw new Error('教学第 1 周的起始日期必须是有效的星期一');
  if (firstTeachingMonday > period.endDate) throw new Error('教学第 1 周不能晚于阶段结束日期');
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new Error('星期值必须为 1 至 7');

  const weeks: number[] = [];
  let skipped = 0;
  for (const week of [...new Set(printedWeeks)].sort((a, b) => a - b)) {
    if (!Number.isInteger(week) || week < 1 || week > 60) throw new Error('教学周次必须是 1 至 60 的整数');
    const date = todayIso(addDays(monday, (week - 1) * 7 + weekday - 1));
    if (date < period.startDate || date > period.endDate) {
      skipped++;
      continue;
    }
    const stageWeek = calculatePeriodWeek(period.startDate, period.endDate, date, period.weekStartsOn);
    if (stageWeek > 60) throw new Error('课程落在阶段第 60 周之后，超出可保存的周次范围');
    weeks.push(stageWeek);
  }
  return { weeks, skipped };
}
