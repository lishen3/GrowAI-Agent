export const GOAL_CATEGORIES = [
  'ENGLISH',
  'PROFESSIONAL',
  'CAREER',
  'PROJECT',
  'FITNESS',
  'COURSE',
  'LIFE',
  'CUSTOM',
] as const;

export type GoalCategory = (typeof GOAL_CATEGORIES)[number];
export type LongTermGoalStatus = 'PLANNED' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';

export type LongTermGoal = {
  id: string;
  journeyId: string;
  title: string;
  description: string | null;
  category: GoalCategory;
  startDate: string;
  targetDescription: string;
  status: LongTermGoalStatus;
  createdAt: string;
  updatedAt: string;
  planning?: import('./progress').GoalPlanning;
};

export type CreateLongTermGoalInput = Pick<
  LongTermGoal,
  'journeyId' | 'title' | 'category' | 'startDate' | 'targetDescription'
> & { description?: string; planning?: import('./progress').GoalPlanning };

export const GOAL_CATEGORY_LABELS: Record<GoalCategory, string> = {
  ENGLISH: '英语',
  PROFESSIONAL: '专业能力',
  CAREER: '职业发展',
  PROJECT: '项目',
  FITNESS: '健身',
  COURSE: '课程',
  LIFE: '生活',
  CUSTOM: '自定义',
};
