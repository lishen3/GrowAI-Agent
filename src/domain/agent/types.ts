import type { GoalPriority, PlanningCategory, PlanningGoalStatus } from '@/domain/goals/planningTypes';
import type { LongTermGoalStatus } from '@/domain/goals/types';
import type { PeriodStatus, PeriodType } from '@/domain/periods/types';
import type { TaskStatus } from '@/domain/tasks/types';
import type { Memory } from '@/domain/memory/types';
import type { SchedulingContext } from '@/domain/scheduling/schedulingContext';

export type AgentTaskFact = {
  categoryId?: string;
  id: string;
  title: string;
  category: PlanningCategory;
  priority: GoalPriority;
  status: TaskStatus;
  plannedDate: string;
  estimatedMinutes: number | null;
  weeklyGoalId: string | null;
  periodGoalId?: string | null;
};

export type AgentExecutionFact = {
  id: string;
  taskId: string;
  completedAt: string;
  plannedMinutesSnapshot: number | null;
  actualMinutes: number | null;
  completionNote: string | null;
  result: string | null;
  learned: string | null;
};

/** Review membership may come from a ScheduleEvent; never invent a Task plannedDate. */
export type ReviewTaskFact = Omit<AgentTaskFact, 'plannedDate'> & { plannedDate: string | null };

export type AgentAchievementFact = {
  categoryId?: string;
  id: string;
  sourceId: string;
  title: string;
  category: PlanningCategory;
  occurredAt: string;
  plannedDurationSnapshot: number | null;
  actualDuration: number | null;
  summary: string | null;
  result: string | null;
  isMilestone: boolean;
};

export type CategoryBreakdown = {
  categoryId?: string;
  category: PlanningCategory;
  plannedTaskCount: number;
  completedTaskCount: number;
  plannedMinutes: number | null;
  actualMinutes: number | null;
};

export type PlanVsReality = {
  plannedTaskCount: number;
  completedTaskCount: number;
  unfinishedTaskCount: number;
  cancelledTaskCount: number;
  plannedMinutes: number | null;
  actualMinutes: number | null;
  completionRate: number | null;
  categoryBreakdown: CategoryBreakdown[];
  unfinishedTasks: ReviewTaskFact[];
  completedTasks: ReviewTaskFact[];
};

export type ReviewFacts = {
  windowStart: string;
  windowEnd: string;
  plannedTaskCount: number;
  completedTaskCount: number;
  unfinishedTaskCount: number;
  cancelledTaskCount: number;
  plannedMinutes: number | null;
  actualMinutes: number | null;
  achievementCount: number;
  categoryBreakdown: CategoryBreakdown[];
};

export type AgentContext = {
  /** Time scheduling only; reflection and DateOnly keep their original weekly boundaries. */
  timeWindow?: { startDate: string; endDate: string };
  /** Reflection-only, bounded projection; never expands DateOnly task candidates. */
  reflectionTasks?: Array<ReviewTaskFact & { periodId: string }>;
  reflectionTimeZone?: string;
  reflectionWindow?: { startAt: string; endExclusiveAt: string };
  reflectionTotals?: { executionCount: number; actualMinutes: number | null; unknownMinutesCount: number;
    executionsTruncated: boolean; achievementsTruncated: boolean };
  reflectionHistory?: Array<{ id: string; periodId: string; startDate: string; endDate: string; summary: string }>;
  categories?: import('@/domain/categories/types').ActionCategory[];
  generatedAt: string;
  journey: { id: string; name: string; startedAt: string };
  currentPeriod: {
    id: string; name: string; type: PeriodType; status: PeriodStatus;
    startDate: string; endDate: string;
  };
  currentWeek: { index: number; windowStart: string; windowEnd: string };
  longTermGoals: Array<{
    id: string; title: string; category: PlanningCategory; status: LongTermGoalStatus;
    targetDescription: string;
    planning?: import('@/domain/goals/progress').GoalPlanning;
    progress?: { percent: number; source: string } | null;
  }>;
  periodGoals: Array<{
    id: string; longTermGoalId: string | null; title: string; category: PlanningCategory;
    priority: GoalPriority; status: PlanningGoalStatus; successCriteria: string[];
  }>;
  weeklyGoals: Array<{
    id: string; periodGoalId: string; title: string; category: PlanningCategory;
    priority: GoalPriority; status: PlanningGoalStatus; targetValue: number | null; targetUnit: string | null;
  }>;
  tasks: AgentTaskFact[];
  recentExecutions: AgentExecutionFact[];
  recentAchievements: AgentAchievementFact[];
  planVsReality: PlanVsReality;
  reviewFacts: ReviewFacts;
  memories: Memory[];
  schedule?: SchedulingContext | null;
};

export type BuildAgentContextInput = {
  journeyId: string;
  periodId?: string;
  date: string;
  /** Explicit read window for time scheduling; DateOnly callers keep the default. */
  weekIndex?: number;
};
