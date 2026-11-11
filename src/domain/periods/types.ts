export const PERIOD_TYPES = [
  'SEMESTER',
  'WINTER_BREAK',
  'SUMMER_BREAK',
  'INTERNSHIP',
  'EXAM',
  'JOB_SEARCH',
  'CUSTOM',
] as const;

export type PeriodType = (typeof PERIOD_TYPES)[number];
export type PeriodStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED';

export type Period = {
  id: string;
  journeyId: string;
  name: string;
  type: PeriodType;
  startDate: string;
  endDate: string;
  status: PeriodStatus;
  description: string | null;
  weekStartsOn: 1 | 7;
  currentWeekOverride: number | null;
  createdAt: string;
  completedAt: string | null;
};

export type CreatePeriodInput = {
  journeyId: string;
  name: string;
  type: PeriodType;
  startDate: string;
  endDate: string;
  description?: string;
};

export const PERIOD_TYPE_LABELS: Record<PeriodType, string> = {
  SEMESTER: '学期',
  WINTER_BREAK: '寒假',
  SUMMER_BREAK: '暑假',
  INTERNSHIP: '实习期',
  EXAM: '考试期',
  JOB_SEARCH: '求职期',
  CUSTOM: '自定义',
};

export const PERIOD_STATUS_LABELS: Record<PeriodStatus, string> = {
  PLANNED: '已计划',
  ACTIVE: '进行中',
  COMPLETED: '已完成',
};
