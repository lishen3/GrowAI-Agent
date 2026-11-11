/** AI Time uses the backend's Asia/Shanghai contract, independently of device timezone. */
export function timeRuntimeDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error('INVALID_TIME_CLOCK');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function assertFutureTimeSlot(slot: { date: string; startTime: string }, now: Date): void {
  const start = Date.parse(`${slot.date}T${slot.startTime}:00+08:00`);
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(start) || start < now.getTime()) throw new Error('TARGET_TIME_IS_PAST');
}

export function isTimeBlockAdjustable(
  event: { date: string; startTime: string; type: string; source: string; taskId: string | null; periodId: string },
  task: { id: string; periodId: string; status: string } | null | undefined,
  now: Date = new Date(),
): boolean {
  const start = Date.parse(`${event.date}T${event.startTime}:00+08:00`);
  return event.type === 'TASK' && event.source === 'USER' && !!task && event.taskId === task.id
    && event.periodId === task.periodId && ['TODO', 'DELAYED'].includes(task.status)
    && Number.isFinite(start) && Number.isFinite(now.getTime()) && start > now.getTime();
}
