import { z } from 'zod';
import { GOAL_CATEGORIES, type LongTermGoal } from '@/domain/goals/types';
import {
  GOAL_PRIORITIES,
  PLANNING_CATEGORIES,
  type InitialPlanData,
  type InitialPlanImportResult,
  type PeriodGoal,
  type WeeklyGoal,
} from '@/domain/goals/planningTypes';
import { PERIOD_TYPES, type Period } from '@/domain/periods/types';
import type { GrowthJourney } from '@/domain/journey/types';
import { isIsoDate } from '@/shared/date';

const isoDate = z.string().refine(isIsoDate, '日期格式应为 YYYY-MM-DD');
const stableId = z.string().trim().min(1, 'ID 不能为空');
const status = z.enum(['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED']);

const sourceLongTermGoalSchema = z.object({
  id: stableId,
  title: z.string().trim().min(1),
  category: z.enum(GOAL_CATEGORIES),
  priority: z.enum(GOAL_PRIORITIES),
  status: z.enum(['PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']),
  startDate: isoDate,
  targetDescription: z.string().trim().min(1),
  principles: z.array(z.string().trim().min(1)).optional(),
}).strict();

const sourcePeriodGoalSchema = z.object({
  id: stableId,
  periodId: stableId,
  longTermGoalId: stableId.optional(),
  title: z.string().trim().min(1),
  category: z.enum(PLANNING_CATEGORIES),
  priority: z.enum(GOAL_PRIORITIES),
  status,
  targetDescription: z.string().trim().min(1),
  successCriteria: z.array(z.string().trim().min(1)).optional(),
  learningPath: z.array(z.string().trim().min(1)).optional(),
}).strict();

const sourceWeeklyGoalSchema = z.object({
  id: stableId,
  periodGoalId: stableId,
  title: z.string().trim().min(1),
  category: z.enum(PLANNING_CATEGORIES),
  priority: z.enum(GOAL_PRIORITIES),
  targetValue: z.number().finite().nonnegative(),
  targetUnit: z.string().trim().min(1),
  status,
  description: z.string().trim().min(1).optional(),
}).strict();

const sourceWeeklyPlanSchema = z.object({
  weekNumber: z.number().int().positive(),
  startDate: isoDate,
  endDate: isoDate,
  theme: z.string().trim().min(1),
  goals: z.array(sourceWeeklyGoalSchema),
}).strict();

export const initialPlanSeedSchema = z.object({
  schemaVersion: z.literal(1),
  generatedFor: z.literal('GrowAI'),
  period: z.object({
    id: stableId,
    name: z.string().trim().min(1),
    type: z.enum(PERIOD_TYPES),
    startDate: isoDate,
    endDate: isoDate,
    totalTeachingWeeks: z.number().int().positive(),
    status: z.enum(['PLANNED', 'ACTIVE', 'COMPLETED']),
    description: z.string().trim().min(1),
  }).strict(),
  longTermGoals: z.array(sourceLongTermGoalSchema),
  periodGoals: z.array(sourcePeriodGoalSchema),
  weeklyPlans: z.array(sourceWeeklyPlanSchema),
  adaptiveRules: z.array(z.object({
    id: stableId,
    description: z.string().trim().min(1),
  }).strict()),
}).strict().superRefine((seed, context) => {
  if (seed.period.endDate < seed.period.startDate) {
    context.addIssue({ code: 'custom', path: ['period', 'endDate'], message: 'Period 结束日期不能早于开始日期' });
  }

  const allIds = [
    seed.period.id,
    ...seed.longTermGoals.map((goal) => goal.id),
    ...seed.periodGoals.map((goal) => goal.id),
    ...seed.weeklyPlans.flatMap((week) => week.goals.map((goal) => goal.id)),
    ...seed.adaptiveRules.map((rule) => rule.id),
  ];
  const duplicateIds = allIds.filter((id, index) => allIds.indexOf(id) !== index);
  if (duplicateIds.length) {
    context.addIssue({ code: 'custom', path: [], message: `存在重复 ID：${[...new Set(duplicateIds)].join(', ')}` });
  }

  const longTermGoalIds = new Set(seed.longTermGoals.map((goal) => goal.id));
  const periodGoalIds = new Set(seed.periodGoals.map((goal) => goal.id));
  for (const goal of seed.periodGoals) {
    if (goal.periodId !== seed.period.id) {
      context.addIssue({ code: 'custom', path: ['periodGoals'], message: `${goal.id} 不属于当前 Period` });
    }
    if (goal.longTermGoalId && !longTermGoalIds.has(goal.longTermGoalId)) {
      context.addIssue({ code: 'custom', path: ['periodGoals'], message: `${goal.id} 引用了不存在的 LongTermGoal` });
    }
  }

  const orderedWeeks = [...seed.weeklyPlans].sort((a, b) => a.weekNumber - b.weekNumber);
  for (let index = 0; index < orderedWeeks.length; index += 1) {
    const week = orderedWeeks[index];
    if (week.weekNumber !== index + 1) {
      context.addIssue({ code: 'custom', path: ['weeklyPlans'], message: '周次必须从 1 开始连续排列' });
    }
    if (week.startDate < seed.period.startDate || week.endDate > seed.period.endDate) {
      context.addIssue({ code: 'custom', path: ['weeklyPlans', index], message: '周计划日期必须位于 Period 内' });
    }
    const start = Date.parse(`${week.startDate}T00:00:00Z`);
    const end = Date.parse(`${week.endDate}T00:00:00Z`);
    if ((end - start) / 86_400_000 !== 6) {
      context.addIssue({ code: 'custom', path: ['weeklyPlans', index], message: '每个周计划必须覆盖连续 7 天' });
    }
    if (index > 0) {
      const previousEnd = Date.parse(`${orderedWeeks[index - 1].endDate}T00:00:00Z`);
      if (start - previousEnd !== 86_400_000) {
        context.addIssue({ code: 'custom', path: ['weeklyPlans', index], message: '周计划日期之间不能有空档或重叠' });
      }
    }
    for (const goal of week.goals) {
      if (!periodGoalIds.has(goal.periodGoalId)) {
        context.addIssue({ code: 'custom', path: ['weeklyPlans', index, 'goals'], message: `${goal.id} 引用了不存在的 PeriodGoal` });
      }
    }
  }
});

export type InitialPlanSeed = z.infer<typeof initialPlanSeedSchema>;

export type DeferredInitialPlanMetadata = {
  generatedFor: 'GrowAI';
  totalTeachingWeeks: number;
  longTermGoals: Array<{ id: string; priority: string; principles: string[] }>;
  weeklyPlans: Array<{ weekNumber: number; startDate: string; endDate: string; theme: string }>;
  adaptiveRules: Array<{ id: string; description: string }>;
};

export type MappedInitialPlanSeed = {
  data: InitialPlanData;
  deferredMetadata: DeferredInitialPlanMetadata;
};

export function mapInitialPlanSeed(
  input: unknown,
  journeyId: string,
  importedAt: string,
): MappedInitialPlanSeed {
  const seed = initialPlanSeedSchema.parse(input);
  const period: Period = {
    id: seed.period.id,
    journeyId,
    name: seed.period.name,
    type: seed.period.type,
    startDate: seed.period.startDate,
    endDate: seed.period.endDate,
    status: seed.period.status,
    description: seed.period.description,
    weekStartsOn: 1,
    currentWeekOverride: null,
    createdAt: importedAt,
    completedAt: null,
  };

  const longTermGoals: LongTermGoal[] = seed.longTermGoals.map((goal) => ({
    id: goal.id,
    journeyId,
    title: goal.title,
    description: null,
    category: goal.category,
    startDate: goal.startDate,
    targetDescription: goal.targetDescription,
    status: goal.status,
    createdAt: importedAt,
    updatedAt: importedAt,
  }));

  const periodGoals: PeriodGoal[] = seed.periodGoals.map((goal) => ({
    id: goal.id,
    periodId: goal.periodId,
    longTermGoalId: goal.longTermGoalId ?? null,
    title: goal.title,
    description: goal.targetDescription,
    category: goal.category,
    priority: goal.priority,
    status: goal.status,
    successCriteria: goal.successCriteria ?? [],
    learningPath: goal.learningPath ?? [],
    createdAt: importedAt,
    completedAt: null,
  }));

  const weeklyGoals: WeeklyGoal[] = seed.weeklyPlans.flatMap((week) => week.goals.map((goal) => ({
    id: goal.id,
    periodId: period.id,
    periodGoalId: goal.periodGoalId,
    weekIndex: week.weekNumber,
    title: goal.title,
    description: goal.description ?? null,
    category: goal.category,
    priority: goal.priority,
    targetValue: goal.targetValue,
    targetUnit: goal.targetUnit,
    successCriteria: [],
    status: goal.status,
    createdAt: importedAt,
    completedAt: null,
  })));

  return {
    data: { period, longTermGoals, periodGoals, weeklyGoals },
    deferredMetadata: {
      generatedFor: seed.generatedFor,
      totalTeachingWeeks: seed.period.totalTeachingWeeks,
      longTermGoals: seed.longTermGoals.map((goal) => ({
        id: goal.id,
        priority: goal.priority,
        principles: goal.principles ?? [],
      })),
      weeklyPlans: seed.weeklyPlans.map(({ weekNumber, startDate, endDate, theme }) => ({
        weekNumber, startDate, endDate, theme,
      })),
      adaptiveRules: seed.adaptiveRules,
    },
  };
}

export type ExistingInitialPlanData = {
  journey: GrowthJourney;
  periods: Period[];
  longTermGoals: LongTermGoal[];
  periodGoals: PeriodGoal[];
  weeklyGoals: WeeklyGoal[];
};

export type InitialPlanMergePlan = {
  periodId: string;
  setAsCurrentPeriod: boolean;
  periodsToInsert: Period[];
  longTermGoalsToInsert: LongTermGoal[];
  periodGoalsToInsert: PeriodGoal[];
  weeklyGoalsToInsert: WeeklyGoal[];
  result: InitialPlanImportResult;
};

function conflict(entity: string, id: string): never {
  throw new Error(`${entity} ${id} 与现有数据冲突，未执行导入`);
}

export function planInitialPlanMerge(
  mapped: InitialPlanData,
  existing: ExistingInitialPlanData,
): InitialPlanMergePlan {
  const sourcePeriod = mapped.period;
  const sameIdPeriod = existing.periods.find((period) => period.id === sourcePeriod.id);
  if (sameIdPeriod && sameIdPeriod.journeyId !== existing.journey.id) conflict('Period', sourcePeriod.id);

  const naturalPeriod = existing.periods.find((period) => (
    period.journeyId === existing.journey.id
    && period.type === sourcePeriod.type
    && period.startDate === sourcePeriod.startDate
    && period.endDate === sourcePeriod.endDate
  ));
  const resolvedPeriod = sameIdPeriod ?? naturalPeriod;
  const periodId = resolvedPeriod?.id ?? sourcePeriod.id;
  const periodsToInsert = resolvedPeriod ? [] : [{ ...sourcePeriod, id: periodId }];

  const longTermGoalsToInsert = mapped.longTermGoals.filter((goal) => {
    const found = existing.longTermGoals.find((current) => current.id === goal.id);
    if (!found) return true;
    if (found.journeyId !== existing.journey.id) {
      conflict('LongTermGoal', goal.id);
    }
    return false;
  });

  const periodGoalsToInsert = mapped.periodGoals.filter((sourceGoal) => {
    const goal = { ...sourceGoal, periodId };
    const found = existing.periodGoals.find((current) => current.id === goal.id);
    if (!found) return true;
    if (
      found.periodId !== periodId
      || found.longTermGoalId !== goal.longTermGoalId
    ) conflict('PeriodGoal', goal.id);
    return false;
  }).map((goal) => ({ ...goal, periodId }));

  const weeklyGoalsToInsert = mapped.weeklyGoals.filter((sourceGoal) => {
    const goal = { ...sourceGoal, periodId };
    const found = existing.weeklyGoals.find((current) => current.id === goal.id);
    if (found) {
      if (
        found.periodId !== periodId
        || found.periodGoalId !== goal.periodGoalId
      ) conflict('WeeklyGoal', goal.id);
      return false;
    }
    const naturalMatch = existing.weeklyGoals.find((current) => (
      current.periodId === periodId
      && current.weekIndex === goal.weekIndex
      && current.title === goal.title
    ));
    return !naturalMatch;
  }).map((goal) => ({ ...goal, periodId }));

  return {
    periodId,
    setAsCurrentPeriod: existing.journey.currentPeriodId === null,
    periodsToInsert,
    longTermGoalsToInsert,
    periodGoalsToInsert,
    weeklyGoalsToInsert,
    result: {
      period: { inserted: periodsToInsert.length, skipped: 1 - periodsToInsert.length },
      longTermGoals: {
        inserted: longTermGoalsToInsert.length,
        skipped: mapped.longTermGoals.length - longTermGoalsToInsert.length,
      },
      periodGoals: {
        inserted: periodGoalsToInsert.length,
        skipped: mapped.periodGoals.length - periodGoalsToInsert.length,
      },
      weeklyGoals: {
        inserted: weeklyGoalsToInsert.length,
        skipped: mapped.weeklyGoals.length - weeklyGoalsToInsert.length,
      },
    },
  };
}
