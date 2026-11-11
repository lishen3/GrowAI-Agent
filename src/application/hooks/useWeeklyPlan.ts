import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { GrowthStore } from '@/application/data/GrowthStore';
import type { Period } from '@/domain/periods/types';
import type { Task } from '@/domain/tasks/types';
import { ScheduleEventApplicationService } from '@/application/scheduling/ScheduleEventApplicationService';
import { calculatePeriodWeek, getPeriodWeekRange, todayIso } from '@/shared/date';
import type { CreateScheduleEvent, ScheduleEventChanges } from '@/domain/scheduling/types';

type Week = Awaited<ReturnType<ScheduleEventApplicationService['queryWeek']>>;
type PlanData = { store: GrowthStore; offset: number; periodId: string; week: Week; index: number; semesterTasks: Task[] };

const semesterStatuses = new Set<Task['status']>(['TODO', 'DOING', 'DELAYED']);

export function useWeeklyPlan(store: GrowthStore, period: Period | null, weekOffset = 0) {
  const [data, setData] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const token = ++generation.current;
    setLoading(true); setError(null);
    try {
      if (!period) return;
      if (!store.scheduleEvents) throw new Error('当前数据源尚不支持排程，请更新应用后重试');
      const currentIndex = period.currentWeekOverride ?? calculatePeriodWeek(
        period.startDate, period.endDate, todayIso(), period.weekStartsOn,
      );
      const totalWeeks = calculatePeriodWeek(period.startDate, period.endDate, period.endDate, period.weekStartsOn);
      const index = Math.min(Math.max(currentIndex + weekOffset, 1), totalWeeks);
      const range = getPeriodWeekRange(period.startDate, period.endDate, index, period.weekStartsOn);
      if (!store.courses) throw new Error('当前数据源尚不支持课程读取，请更新应用后重试');
      const [week, allTasks] = await Promise.all([
        new ScheduleEventApplicationService(store.scheduleEvents, store, store.courses)
          .queryWeek(period.id, range.startDate, range.endDate, {
            periodStart: period.startDate, weekStartsOn: period.weekStartsOn,
          }),
        store.listTasks({ periodId: period.id }),
      ]);
      const semesterTasks = allTasks
        .filter((task) => semesterStatuses.has(task.status))
        .sort((a, b) => (a.deadline ?? '9999-12-31').localeCompare(b.deadline ?? '9999-12-31')
          || (a.plannedDate ?? '9999-12-31').localeCompare(b.plannedDate ?? '9999-12-31')
          || a.title.localeCompare(b.title));
      if (generation.current === token) setData({ store, offset: weekOffset, periodId: period.id, week, index, semesterTasks });
    } catch (caught) {
      if (generation.current === token) setError(caught instanceof Error ? caught.message : '读取周安排失败');
    } finally { if (generation.current === token) setLoading(false); }
  }, [store, period, weekOffset]);
  useFocusEffect(useCallback(() => {
    void reload();
    return () => { generation.current++; };
  }, [reload]));
  const createEvent = useCallback(async (input: CreateScheduleEvent, requestId?: string) => {
    if (!period || input.periodId !== period.id || !store.scheduleEvents) throw new Error('当前阶段或排程能力已变化，请重新读取');
    return new ScheduleEventApplicationService(store.scheduleEvents, store, store.courses).create(input, requestId);
  }, [store, period]);
  const updateEvent = useCallback(async (periodId: string, id: string, changes: ScheduleEventChanges) => {
    if (!period || periodId !== period.id || !store.scheduleEvents) throw new Error('当前阶段或排程能力已变化，请重新读取');
    return new ScheduleEventApplicationService(store.scheduleEvents, store, store.courses).update(periodId, id, changes);
  }, [store, period]);
  const changeTimeBlock = useCallback(async (before: import('@/domain/scheduling/types').ScheduleEvent, after: import('@/domain/scheduling/types').ScheduleEvent) => {
    if(!period || !store.scheduleEvents)throw new Error('当前阶段或排程能力已变化');
    return new ScheduleEventApplicationService(store.scheduleEvents,store,store.courses).updateCalendarTime(period,before,after);
  },[store,period]);
  const deleteEvent = useCallback(async (periodId: string, id: string) => {
    if (!period || periodId !== period.id || !store.scheduleEvents) throw new Error('当前阶段或排程能力已变化，请重新读取');
    return new ScheduleEventApplicationService(store.scheduleEvents, store, store.courses).delete(periodId, id);
  }, [store, period]);
  const visible = data?.store === store && data?.periodId === period?.id && data?.offset === weekOffset;
  return { week: visible ? data?.week ?? null : null,
    weekIndex: visible ? data?.index ?? null : null,
    semesterTasks: visible ? data?.semesterTasks ?? [] : [],
    schedulableTasks: visible ? (data?.semesterTasks ?? []).filter(task => ['TODO', 'DELAYED'].includes(task.status)) : [],
    loading, error, reload, createEvent, updateEvent, deleteEvent, changeTimeBlock };
}
