import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { addDays, endOfMonth, parseISO, startOfMonth } from 'date-fns';
import type { GrowthStore } from '@/application/data/GrowthStore';
import type { Period } from '@/domain/periods/types';
import type { ScheduleEvent } from '@/domain/scheduling/types';
import { ScheduleEventApplicationService } from '@/application/scheduling/ScheduleEventApplicationService';
import { todayIso } from '@/shared/date';

export function useCalendarMonth(store: GrowthStore, period: Period | null, selectedDate: string, enabled: boolean) {
  const month = selectedDate.slice(0, 7);
  const [data, setData] = useState<{ store: GrowthStore; periodId: string; month: string; events: ScheduleEvent[] } | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const token = ++generation.current; if (!enabled) return;
    setLoading(true); setError(null);
    try {
      if (!period || !store.scheduleEvents || !store.courses) throw new Error('当前阶段或日历数据尚未验证');
      const start = todayIso(startOfMonth(parseISO(month + '-01'))), end = todayIso(endOfMonth(parseISO(month + '-01')));
      const first = start < period.startDate ? period.startDate : start, last = end > period.endDate ? period.endDate : end;
      const service = new ScheduleEventApplicationService(store.scheduleEvents, store, store.courses);
      const events: ScheduleEvent[] = [];
      for (let date = first; date <= last; date = todayIso(addDays(parseISO(date), 7))) {
        const next = todayIso(addDays(parseISO(date), 6));
        events.push(...(await service.queryWeek(period.id, date, next < last ? next : last, { periodStart: period.startDate, weekStartsOn: period.weekStartsOn })).events);
      }
      if (generation.current === token) setData({ store, periodId: period.id, month, events: [...new Map(events.map(e => [e.id,e])).values()] });
    } catch (e) { if (generation.current === token) setError(e instanceof Error ? e.message : '月安排读取失败'); }
    finally { if (generation.current === token) setLoading(false); }
  }, [store, period, month, enabled]);
  useFocusEffect(useCallback(() => { void reload(); return () => { generation.current++; }; }, [reload]));
  const visible = data?.store === store && data?.periodId === period?.id && data?.month === month;
  return { events: visible ? data.events : [], loading: enabled && loading, error: enabled ? error : null, reload };
}
