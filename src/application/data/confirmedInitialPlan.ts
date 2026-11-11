import type { GrowthStore } from './GrowthStore';
import confirmedSeed from './seeds/growai-2026-fall.json';

export const confirmedInitialPlanSeed: unknown = confirmedSeed;

export function seedConfirmedInitialPlan(store: GrowthStore) {
  return store.importInitialPlanSeed(confirmedInitialPlanSeed);
}
