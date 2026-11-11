import type { LongTermGoal } from '@/domain/goals/types';
import type { GrowthJourney } from '@/domain/journey/types';
import type { Period } from '@/domain/periods/types';
import { useGrowthStore } from '@/infrastructure/data/DataContext';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

export type GrowthData = {
  journey: GrowthJourney | null;
  periods: Period[];
  goals: LongTermGoal[];
  currentPeriod: Period | null;
};

const emptyData: GrowthData = {
  journey: null,
  periods: [],
  goals: [],
  currentPeriod: null,
};

export function useGrowthData() {
  const store = useGrowthStore();
  const [data, setData] = useState<GrowthData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataStore, setDataStore] = useState(store);
  const currentStore = useRef(store); currentStore.current = store;
  const generation = useRef(0);
  const active = useRef(false);

  const reload = useCallback(async () => {
    if (!active.current || currentStore.current !== store) return;
    const request = ++generation.current;
    const valid = () => active.current && currentStore.current === store && request === generation.current;
    setLoading(true); setError(null);
    try {
      const journey = await store.getJourney();
      if (!journey) {
        if (valid()) { setData(emptyData); setDataStore(store); }
        return;
      }
      const [periods, goals] = await Promise.all([
        store.listPeriods(journey.id),
        store.listLongTermGoals(journey.id),
      ]);
      if (valid()) { setDataStore(store); setData({
        journey,
        periods,
        goals,
        currentPeriod: periods.find((period) => period.id === journey.currentPeriodId) ?? null,
      }); }
    } catch (caught) {
      if (valid()) setError(caught instanceof Error ? caught.message : '读取本地数据失败');
    } finally {
      if (valid()) setLoading(false);
    }
  }, [store]);

  useFocusEffect(useCallback(() => {
    active.current = true; void reload();
    return () => { active.current = false; generation.current++; };
  }, [reload]));

  const visible = dataStore === store;
  return { ...(visible ? data : emptyData), loading: !visible || loading, error: visible ? error : null, reload, store };
}
