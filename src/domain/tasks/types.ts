import type { GoalPriority, PlanningCategory } from '@/domain/goals/planningTypes';

export const TASK_STATUSES = ['TODO', 'DOING', 'DONE', 'DELAYED', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type Task = {
  id: string;
  periodId: string;
  periodGoalId: string | null;
  weeklyGoalId: string | null;
  title: string;
  description: string | null;
  category: PlanningCategory;
  categoryId?: string;
  priority: GoalPriority;
  status: TaskStatus;
  plannedDate: string | null;
  estimatedMinutes: number | null;
  deadline: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type TaskExecution = {
  id: string;
  taskId: string;
  startedAt: string | null;
  completedAt: string;
  plannedMinutesSnapshot: number | null;
  actualMinutes: number | null;
  completionNote: string | null;
  learned: string | null;
  result: string | null;
  createdAt: string;
};

export type Achievement = {
  id: string;
  journeyId: string;
  periodId: string | null;
  sourceType: 'TASK';
  sourceId: string;
  title: string;
  description: string | null;
  category: PlanningCategory;
  categoryId?: string;
  occurredAt: string;
  plannedDurationSnapshot: number | null;
  actualDuration: number | null;
  summary: string | null;
  result: string | null;
  isMilestone: boolean;
  createdAt: string;
};

export type CreateTaskInput = Pick<Task, 'periodId' | 'title' | 'category' | 'priority'>
  & Partial<Pick<Task, 'periodGoalId' | 'weeklyGoalId' | 'description' | 'plannedDate' | 'deadline' | 'estimatedMinutes' | 'categoryId'>>;

export type UpdateTaskInput = {
  taskId: string;
  changes: { title?: string; description?: string; plannedDate?: string; estimatedMinutes?: number; categoryId?: string };
};

export type CompleteTaskInput = {
  taskId: string;
  actualMinutes?: number;
  note?: string;
  result?: string;
  learned?: string;
};

export type TaskCompletionResult = {
  task: Task;
  execution: TaskExecution;
  achievement: Achievement;
};

export type TaskQuery = {
  periodId: string;
  plannedDate?: string;
  plannedFrom?: string;
  plannedTo?: string;
  status?: TaskStatus;
};

export type TaskExecutionQuery = {
  periodId: string;
  completedFrom?: string;
  completedTo?: string;
  limit?: number;
};

export type AchievementQuery = {
  journeyId: string;
  periodId?: string;
  occurredDate?: string;
  occurredFrom?: string;
  occurredTo?: string;
  limit?: number;
};
