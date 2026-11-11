import { addDays, parseISO } from 'date-fns';
import { todayIso } from '@/shared/date';
import { scheduleEventSchema, type ScheduleEvent } from './types';
export const calendarMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export const calendarTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export function calendarDrop(event: ScheduleEvent, dayDelta: number, minuteDelta: number, resize = false): ScheduleEvent {
  const start = calendarMinutes(event.startTime), end = calendarMinutes(event.endTime);
  const delta = Math.round(minuteDelta / 15) * 15;
  const nextStart = resize ? start : start + delta;
  const nextEnd = end + delta;
  if (nextStart < 0 || nextEnd >= 24 * 60 || nextEnd - nextStart < (resize ? 15 : 1)) throw new Error('时间必须在同一天内且至少15分钟');
  return scheduleEventSchema.parse({ ...event, date: resize ? event.date : todayIso(addDays(parseISO(event.date), dayDelta)), startTime: calendarTime(nextStart), endTime: calendarTime(nextEnd) });
}
