import type { GoalCategory, LongTermGoal } from './types';
import type { Period } from '../periods/types';

export const GOAL_PRIORITIES = ['S', 'A', 'B', 'C'] as const;
export const PLANNING_CATEGORIES = [
  'ENGLISH',
  'PROFESSIONAL',
  'CAREER',
  'PROJECT',
  'FITNESS',
  'COURSE',
  'LIFE',
  'CUSTOM',
  'INTERNSHIP',
  'REVIEW',
] as const;

export type GoalPriority = (typeof GOAL_PRIORITIES)[number];
export type PlanningCategory = GoalCategory | 'INTERNSHIP' | 'REVIEW';
export type PlanningGoalStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export type PeriodGoal = {
  id: string;
  periodId: string;
  longTermGoalId: string | null;
  title: string;
  description: string | null;
  category: PlanningCategory;
  priority: GoalPriority;
  status: PlanningGoalStatus;
  successCriteria: string[];
  learningPath: string[];
  createdAt: string;
  completedAt: string | null;
};

export type WeeklyGoal = {
  id: string;
  periodId: string;
  periodGoalId: string;
  weekIndex: number;
  title: string;
  description: string | null;
  category: PlanningCategory;
  priority: GoalPriority;
  targetValue: number | null;
  targetUnit: string | null;
  successCriteria: string[];
  status: PlanningGoalStatus;
  createdAt: string;
  completedAt: string | null;
};

export type InitialPlanData = {
  period: Period;
  longTermGoals: LongTermGoal[];
  periodGoals: PeriodGoal[];
  weeklyGoals: WeeklyGoal[];
};

export type InitialPlanImportResult = {
  period: { inserted: number; skipped: number };
  longTermGoals: { inserted: number; skipped: number };
  periodGoals: { inserted: number; skipped: number };
  weeklyGoals: { inserted: number; skipped: number };
};
