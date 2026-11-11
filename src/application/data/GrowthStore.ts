import type { CreateLongTermGoalInput, LongTermGoal } from '@/domain/goals/types';
import type { InitialPlanImportResult, PeriodGoal, WeeklyGoal } from '@/domain/goals/planningTypes';
import type { GrowthJourney } from '@/domain/journey/types';
import type { CreatePeriodInput, Period } from '@/domain/periods/types';
import type { Achievement, Task, TaskExecution } from '@/domain/tasks/types';
import type { TaskGateway } from '@/application/tasks/TaskApplicationService';
import type { MemoryGateway } from '@/application/memory/MemoryApplicationService';
import type { ReflectionStore } from '@/application/reflection/WeeklyReflectionService';
import type { Memory } from '@/domain/memory/types';
import type { Reflection } from '@/domain/reflection/types';
import type { ScheduleEvent } from '@/domain/scheduling/types';
import type { ScheduleEventRepository } from '@/application/scheduling/ScheduleEventApplicationService';
import type { Course } from '@/domain/courses/types';
import type { CourseRepository } from '@/application/courses/CourseApplicationService';

export type GrowthSnapshot = {
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6;
  categories?: import('@/domain/categories/types').ActionCategory[];
  exportedAt: string;
  journey: GrowthJourney;
  periods: Period[];
  goals: LongTermGoal[];
  periodGoals: PeriodGoal[];
  weeklyGoals: WeeklyGoal[];
  tasks?: Task[];
  taskExecutions?: TaskExecution[];
  achievements?: Achievement[];
  memories?: Memory[];
  reflections?: Reflection[];
  scheduleEvents?: ScheduleEvent[];
  courses?: Course[];
};

export interface GrowthStore extends TaskGateway, MemoryGateway, ReflectionStore {
  createScheduledTaskAtomic?(input: import('@/domain/tasks/types').CreateTaskInput, slot: Pick<ScheduleEvent, 'date' | 'startTime' | 'endTime'>, requestId: string): Promise<{ task: Task; event: ScheduleEvent }>;
  createPeriodGoal?(periodId: string, goalId: string, title: string): Promise<PeriodGoal>;
  assignTaskGoal?(expected: Task, periodGoalId: string | null): Promise<void>;
  deleteUnscheduledTask?(taskId: string, periodId: string): Promise<void>;
  clearLocalData?(): Promise<void>;
  categories?: import('@/domain/categories/types').CategoryRepository;
  conversations?: import('@/domain/agent/conversation').ConversationRepository;
  convertPersonalEvent?(expected: ScheduleEvent, input: import('@/domain/tasks/types').CreateTaskInput): Promise<{ task: Task; event: ScheduleEvent }>;
  scheduleEvents?: ScheduleEventRepository;
  courses?: CourseRepository;
  /** Read-only consistency token; never grants write permission. */
  getContextVersion?(): Promise<string>;
  getJourney(): Promise<GrowthJourney | null>;
  listPeriods(journeyId: string): Promise<Period[]>;
  listLongTermGoals(journeyId: string): Promise<LongTermGoal[]>;
  listPeriodGoals(periodId: string): Promise<PeriodGoal[]>;
  listWeeklyGoals(periodId: string, weekIndex?: number): Promise<WeeklyGoal[]>;
  createPeriod(input: CreatePeriodInput): Promise<Period>;
  setCurrentPeriod(journeyId: string, periodId: string): Promise<void>;
  updateGoalPlanning?(journeyId: string, goalId: string, planning: import('@/domain/goals/progress').GoalPlanning, expectedUpdatedAt: string): Promise<void>;
  createLongTermGoal(input: CreateLongTermGoalInput): Promise<LongTermGoal>;
  importInitialPlanSeed(input: unknown): Promise<InitialPlanImportResult>;
  exportSnapshot(): Promise<GrowthSnapshot>;
  importSnapshot?(snapshot: GrowthSnapshot): Promise<void>;
}
