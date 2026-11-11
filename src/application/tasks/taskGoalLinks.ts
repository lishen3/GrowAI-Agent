import type { GrowthStore } from '@/application/data/GrowthStore';
import type { CreateTaskInput } from '@/domain/tasks/types';
import { calculatePeriodWeek } from '@/shared/date';
export async function resolveTaskGoalLinks(store: Pick<GrowthStore, 'getJourney' | 'listPeriods' | 'listPeriodGoals' | 'listWeeklyGoals' | 'listLongTermGoals'>, input: CreateTaskInput): Promise<CreateTaskInput> {
  if (!input.periodGoalId && !input.weeklyGoalId) return input;
  const journey = await store.getJourney();
  const period = journey && (await store.listPeriods(journey.id)).find(item => item.id === input.periodId);
  if (!journey || !period) throw new Error('目标不属于当前旅程阶段');
  const [periodGoals, weeklyGoals, goals] = await Promise.all([
    store.listPeriodGoals(period.id), store.listWeeklyGoals(period.id), store.listLongTermGoals(journey.id),
  ]);
  const weekly = input.weeklyGoalId ? weeklyGoals.find(item => item.id === input.weeklyGoalId) : null;
  const periodGoalId = input.periodGoalId ?? weekly?.periodGoalId;
  const parent = periodGoals.find(item => item.id === periodGoalId && item.periodId === period.id);
  if (!parent || parent.status === 'CANCELLED'
    || parent.longTermGoalId && !goals.some(item => item.id === parent.longTermGoalId && item.journeyId === journey.id)) throw new Error('阶段目标归属无效');
  if (input.weeklyGoalId && (!weekly || weekly.periodId !== period.id || weekly.periodGoalId !== parent.id || weekly.status === 'CANCELLED'
    || input.plannedDate && weekly.weekIndex !== calculatePeriodWeek(period.startDate, period.endDate, input.plannedDate, period.weekStartsOn))) throw new Error('周目标与阶段目标或日期不一致');
  return { ...input, periodGoalId: parent.id };
}
