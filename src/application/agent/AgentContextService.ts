import { goalProgress, goalPlanningSchema } from '@/domain/goals/progress';
import type { GrowthStore } from '@/application/data/GrowthStore';
import { MemoryApplicationService } from '@/application/memory/MemoryApplicationService';
import { calculatePlanVsReality, occurredInWindow, selectTasksForWindow } from '@/domain/agent/planVsReality';
import type { AgentContext, BuildAgentContextInput } from '@/domain/agent/types';
import { ScheduleEventApplicationService } from '@/application/scheduling/ScheduleEventApplicationService';
import { buildSchedulingContext } from '@/domain/scheduling/schedulingContext';
import { detectScheduleConflicts } from '@/domain/scheduling/detectScheduleConflicts';
import { calculatePeriodWeek, getPeriodWeekRange, isIsoDate, todayIso } from '@/shared/date';
import { addDays, formatISO, parseISO } from 'date-fns';

const MAX_RECENT_EXECUTIONS = 100;
const MAX_RECENT_ACHIEVEMENTS = 50;

export class AgentContextService {
  constructor(
    private readonly store: GrowthStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async consistentRead<T>(read: () => Promise<T>): Promise<T> {
    const before = await this.store.getContextVersion?.();
    const result = await read();
    if (before !== undefined && before !== await this.store.getContextVersion!()) {
      throw new Error('读取期间数据已变化，请重新读取后再生成；未调用模型');
    }
    return result;
  }

  buildTime(input: BuildAgentContextInput, timeWindow?: { startDate: string; endDate: string }): Promise<AgentContext> {
    return this.consistentRead(() => this.buildTimeUnchecked(input, timeWindow));
  }

  buildReflection(input: BuildAgentContextInput): Promise<AgentContext> {
    return this.consistentRead(() => this.buildReflectionUnchecked(input));
  }

  build(input: BuildAgentContextInput, forReflection = false): Promise<AgentContext> {
    return this.consistentRead(() => this.buildUnchecked(input, forReflection));
  }

  /** Time-only candidate facts. Never broaden DateOnly root tasks or reflection membership. */
  private async buildTimeUnchecked(input: BuildAgentContextInput, timeWindow?: { startDate: string; endDate: string }): Promise<AgentContext> {
    const context = await this.buildUnchecked(input);
    if (!context.schedule || !this.store.scheduleEvents) return context;
    const periodId = context.currentPeriod.id;
    const tasks = await this.store.listTasks({ periodId });
    let schedule = context.schedule;
    if (timeWindow) {
      if (!isIsoDate(timeWindow.startDate) || !isIsoDate(timeWindow.endDate)
        || timeWindow.startDate < context.currentPeriod.startDate || timeWindow.endDate > context.currentPeriod.endDate
        || timeWindow.endDate < timeWindow.startDate
        || timeWindow.endDate > todayIso(addDays(parseISO(timeWindow.startDate), 13))) throw new Error('排程窗口必须在阶段内且不超过14天');
      const service = new ScheduleEventApplicationService(this.store.scheduleEvents, this.store, this.store.courses);
      const period = (await this.store.listPeriods(context.journey.id)).find(row => row.id === periodId);
      if (!period) throw new Error('当前阶段不存在');
      const events = [];
      for (let start = timeWindow.startDate; start <= timeWindow.endDate; start = todayIso(addDays(parseISO(start), 7))) {
        const end = todayIso(addDays(parseISO(start), 6));
        const week = await service.queryWeek(periodId, start, end < timeWindow.endDate ? end : timeWindow.endDate,
          { periodStart: context.currentPeriod.startDate, weekStartsOn: period.weekStartsOn });
        events.push(...week.events);
      }
      schedule = buildSchedulingContext({ startDate: timeWindow.startDate, endDate: timeWindow.endDate,
        events, conflicts: detectScheduleConflicts(events), unscheduledTasks: [] }, tasks);
    }
    const facts = tasks.filter(task => task.periodId === periodId && !['DONE', 'CANCELLED'].includes(task.status));
    const fact = ({ id, periodId, title, status, plannedDate, estimatedMinutes, categoryId, periodGoalId, weeklyGoalId, priority }: typeof facts[number]) =>
      ({ id, periodId, title, status, plannedDate, estimatedMinutes, periodGoalId, weeklyGoalId, priority, ...(categoryId ? { categoryId } : {}) });
    return { ...context, ...(timeWindow ? { timeWindow } : {}), schedule: { ...schedule,
      unscheduledTasks: facts.map(task => {
        const { periodId: _periodId, ...value } = fact(task); return value;
      }), linkedTaskFacts: facts.filter(task => schedule.events.some(event =>
        (event.kind === 'TASK' || event.kind === 'AI_ADJUSTMENT') && event.taskId === task.id)).map(fact) } };
  }

  private async buildReflectionUnchecked(input: BuildAgentContextInput): Promise<AgentContext> {
    const context = await this.buildUnchecked(input, true);
    const { windowStart: start, windowEnd: end } = context.currentWeek;
    const [tasks, events, history, weeklyGoals] = await Promise.all([
      this.store.listTasks({ periodId: context.currentPeriod.id }),
      this.store.scheduleEvents?.queryByDateRange({ periodId: context.currentPeriod.id,
        startDate: context.currentPeriod.startDate, endDate: context.currentPeriod.endDate }) ?? Promise.resolve(undefined),
      this.store.listReflections(context.journey.id),
      this.store.listWeeklyGoals(context.currentPeriod.id),
    ]);
    const scoped = tasks.filter(row => row.periodId === context.currentPeriod.id);
    const ids = new Set([...selectTasksForWindow(scoped, start, end, events).map(row => row.id),
      ...context.recentExecutions.map(row => row.taskId), ...context.recentAchievements.map(row => row.sourceId)]);
    const neededWeeklyGoals = new Set(scoped.filter(row => ids.has(row.id)).map(row => row.weeklyGoalId));
    return { ...context, reflectionTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      weeklyGoals: weeklyGoals.filter(row => row.periodId === context.currentPeriod.id
        && (neededWeeklyGoals.has(row.id) || context.weeklyGoals.some(goal => goal.id === row.id))).map(row => ({
          id: row.id, periodGoalId: row.periodGoalId, title: row.title, category: row.category,
          priority: row.priority, status: row.status, targetValue: row.targetValue, targetUnit: row.targetUnit,
        })),
      reflectionWindow: { startAt: formatISO(parseISO(start)), endExclusiveAt: formatISO(addDays(parseISO(end), 1)) },
      reflectionTasks: scoped.filter(row => ids.has(row.id)).map(row => ({
        id: row.id, periodId: row.periodId, title: row.title, category: row.category,
        ...(row.categoryId ? { categoryId: row.categoryId } : {}), priority: row.priority, status: row.status,
        plannedDate: row.plannedDate, estimatedMinutes: row.estimatedMinutes,
        weeklyGoalId: row.weeklyGoalId, periodGoalId: row.periodGoalId,
      })),
      reflectionHistory: history.filter(row => row.journeyId === context.journey.id && row.endDate < start)
        .sort((a, b) => b.endDate.localeCompare(a.endDate) || b.createdAt.localeCompare(a.createdAt)).slice(0, 4)
        .map(({ id, periodId, startDate, endDate, summary }) => ({ id, periodId, startDate, endDate, summary: summary.slice(0, 1000) })),
    };
  }

  async resolveWeek(input: BuildAgentContextInput) {
    if (!isIsoDate(input.date)) throw new Error('Context 日期格式应为 YYYY-MM-DD');
    const journey = await this.store.getJourney();
    if (!journey || journey.id !== input.journeyId) throw new Error('成长旅程不存在');

    const periods = await this.store.listPeriods(journey.id);
    const periodId = input.periodId ?? journey.currentPeriodId;
    const period = periods.find((item) => item.id === periodId);
    if (!period) throw new Error('当前阶段不存在或不属于该成长旅程');

    const weekIndex = input.weekIndex ?? period.currentWeekOverride ?? calculatePeriodWeek(
      period.startDate, period.endDate, input.date, period.weekStartsOn,
    );
    const window = getPeriodWeekRange(
      period.startDate, period.endDate, weekIndex, period.weekStartsOn,
    );

    return { journey, period, weekIndex, window };
  }

  private async buildUnchecked(input: BuildAgentContextInput, forReflection = false): Promise<AgentContext> {
    const { journey, period, weekIndex, window } = await this.resolveWeek(input);

    const scheduleService = this.store.scheduleEvents && this.store.courses
      ? new ScheduleEventApplicationService(this.store.scheduleEvents, this.store, this.store.courses)
      : null;
    const taskRead = scheduleService
      ? scheduleService.queryWeekWithTasks(period.id, window.startDate, window.endDate, {
        periodStart: period.startDate, weekStartsOn: period.weekStartsOn,
      })
      : this.store.listTasks(this.store.scheduleEvents ? { periodId: period.id }
        : { periodId: period.id, plannedFrom: window.startDate, plannedTo: window.endDate })
        .then((tasks) => ({ tasks, week: null }));
    const [longTermGoals, periodGoals, weeklyGoals, taskResult, executionRows, achievementRows, memories, periodEvents] = await Promise.all([
      this.store.listLongTermGoals(journey.id),
      this.store.listPeriodGoals(period.id),
      this.store.listWeeklyGoals(period.id, weekIndex),
      taskRead,
      this.store.listExecutions({
        periodId: period.id, completedFrom: window.startDate, completedTo: window.endDate,
      }),
      this.store.listAchievements({
        journeyId: journey.id, periodId: period.id,
        occurredFrom: window.startDate, occurredTo: window.endDate,
      }),
      new MemoryApplicationService(this.store).listRelevantMemories(journey.id),
      this.store.scheduleEvents?.queryByDateRange({ periodId: period.id, startDate: period.startDate, endDate: period.endDate })
        ?? Promise.resolve(undefined),
    ]);
    const executions = [...new Map(executionRows.filter(row => occurredInWindow(row.completedAt, window.startDate, window.endDate))
      .map(row => [row.id, row])).values()];
    const achievements = [...new Map(achievementRows.filter(row => row.journeyId === journey.id && row.periodId === period.id
      && occurredInWindow(row.occurredAt, window.startDate, window.endDate)).map(row => [row.id, row])).values()];
    const tasks = taskResult.tasks.filter(task => task.periodId === period.id && task.plannedDate !== null
      && task.plannedDate >= window.startDate && task.plannedDate <= window.endDate);
    const schedule = scheduleService && taskResult.week
      ? buildSchedulingContext(taskResult.week, taskResult.tasks)
      : null;
    const planVsReality = calculatePlanVsReality(
      taskResult.tasks, executions, window.startDate, window.endDate, periodEvents,
    );

    const categories = this.store.categories ? await this.store.categories.list(journey.id) : undefined;
    if (categories && taskResult.tasks.some(task => task.categoryId && !categories.some(row => row.id === task.categoryId))) throw new Error('任务分类事实无效');
    return {
      ...(forReflection ? { reflectionTotals: {
        executionCount: executions.length,
        actualMinutes: !executions.length || executions.some(row => row.actualMinutes === null)
          ? null : executions.reduce((total, row) => total + row.actualMinutes!, 0),
        unknownMinutesCount: executions.filter(row => row.actualMinutes === null).length,
        executionsTruncated: executions.length > MAX_RECENT_EXECUTIONS,
        achievementsTruncated: achievements.length > MAX_RECENT_ACHIEVEMENTS,
      } } : {}),
      ...(categories ? { categories } : {}),
      generatedAt: this.now().toISOString(),
      memories,
      journey: { id: journey.id, name: journey.name, startedAt: journey.startedAt },
      currentPeriod: {
        id: period.id, name: period.name, type: period.type, status: period.status,
        startDate: period.startDate, endDate: period.endDate,
      },
      currentWeek: { index: weekIndex, windowStart: window.startDate, windowEnd: window.endDate },
      longTermGoals: longTermGoals.map((goal) => ({
        id: goal.id, title: goal.title, category: goal.category, status: goal.status,
        targetDescription: goal.targetDescription,
        ...(goal.planning ? { planning: goalPlanningSchema.parse(goal.planning), progress: goalProgress(goal.planning) } : {}),
      })),
      periodGoals: periodGoals.map((goal) => ({
        id: goal.id, longTermGoalId: goal.longTermGoalId, title: goal.title,
        category: goal.category, priority: goal.priority, status: goal.status,
        successCriteria: goal.successCriteria,
      })),
      weeklyGoals: weeklyGoals.map((goal) => ({
        id: goal.id, periodGoalId: goal.periodGoalId, title: goal.title,
        category: goal.category, priority: goal.priority, status: goal.status,
        targetValue: goal.targetValue, targetUnit: goal.targetUnit,
      })),
      tasks: tasks.map((task) => ({
        ...(task.categoryId ? { categoryId: task.categoryId } : {}), id: task.id, title: task.title, category: task.category, priority: task.priority,
        status: task.status, plannedDate: task.plannedDate!, estimatedMinutes: task.estimatedMinutes,
        weeklyGoalId: task.weeklyGoalId, periodGoalId: task.periodGoalId,
      })),
      recentExecutions: executions.slice(0, MAX_RECENT_EXECUTIONS).map((execution) => ({
        id: execution.id, taskId: execution.taskId, completedAt: execution.completedAt,
        plannedMinutesSnapshot: execution.plannedMinutesSnapshot, actualMinutes: execution.actualMinutes,
        completionNote: execution.completionNote, result: execution.result, learned: execution.learned,
      })),
      recentAchievements: achievements.slice(0, MAX_RECENT_ACHIEVEMENTS).map((achievement) => ({
        ...(achievement.categoryId ? { categoryId: achievement.categoryId } : {}), id: achievement.id, sourceId: achievement.sourceId, title: achievement.title,
        category: achievement.category, occurredAt: achievement.occurredAt,
        plannedDurationSnapshot: achievement.plannedDurationSnapshot,
        actualDuration: achievement.actualDuration, summary: achievement.summary,
        result: achievement.result, isMilestone: achievement.isMilestone,
      })),
      planVsReality,
      reviewFacts: {
        windowStart: window.startDate,
        windowEnd: window.endDate,
        plannedTaskCount: planVsReality.plannedTaskCount,
        completedTaskCount: planVsReality.completedTaskCount,
        unfinishedTaskCount: planVsReality.unfinishedTaskCount,
        cancelledTaskCount: planVsReality.cancelledTaskCount,
        plannedMinutes: planVsReality.plannedMinutes,
        actualMinutes: planVsReality.actualMinutes,
        achievementCount: achievements.length,
        categoryBreakdown: planVsReality.categoryBreakdown,
      },
      schedule,
    };
  }
}
