import type { GrowthStore } from '@/application/data/GrowthStore';
import { createContext, useContext } from 'react';

export const DataContext = createContext<GrowthStore | null>(null);

export function useGrowthStore(): GrowthStore {
  const store = useContext(DataContext);
  if (!store) throw new Error('GrowAI 本地数据服务尚未初始化');
  return store;
}
