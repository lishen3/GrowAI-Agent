import { useEffect, useState } from 'react';
import type { GrowthStore } from '@/application/data/GrowthStore';
import { defaultCategories, type ActionCategory } from '@/domain/categories/types';
export function useCategories(store: GrowthStore, journeyId?: string) {
  const [state, setState] = useState<{ store: GrowthStore; journeyId?: string; rows: ActionCategory[]; error: string | null } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void (async () => {
      const journey = await store.getJourney();
      if (!journey || journeyId && journey.id !== journeyId || !store.categories) throw new Error('分类数据尚未验证');
      const rows = await store.categories.list(journey.id);
      if (active) setState({ store,journeyId,rows,error: null });
    })().catch(error => { if (active) setState({ store,journeyId,rows: [],error: error instanceof Error ? error.message : '分类读取失败' }); });
    const unsubscribe = store.categories?.subscribe?.(() => setRevision(value => value + 1));
    return () => { active = false; unsubscribe?.(); };
  }, [store,journeyId,revision]);
  const visible = state?.store === store && state.journeyId === journeyId;
  return { rows: visible ? state.rows : defaultCategories(journeyId ?? ''), loading: !visible,
    error: visible ? state.error : null, reload: () => setRevision(value => value + 1),
    name: (id: string) => (visible ? state.rows : defaultCategories(journeyId ?? '')).find(row => row.id === id)?.name ?? '分类记录待确认' };
}
