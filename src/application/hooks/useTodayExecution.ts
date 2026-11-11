import { TaskApplicationService } from '@/application/tasks/TaskApplicationService';
import { TodayExecutionService, type TodayPersonalEvent } from '@/application/tasks/TodayExecutionService';
import { ScheduleEventApplicationService } from '@/application/scheduling/ScheduleEventApplicationService';
import { combineTodayTodos } from './todayTodos';
import { selectTaskPool } from './taskPool';
import type { Period } from '@/domain/periods/types';
import type { ScheduleEvent } from '@/domain/scheduling/types';
import type { WeeklyGoal } from '@/domain/goals/planningTypes';
import type { Achievement, CompleteTaskInput, CreateTaskInput, Task, TaskExecution } from '@/domain/tasks/types';
import { useGrowthStore } from '@/infrastructure/data/DataContext';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';

export function useTodayExecution(
  journeyId: string | null, periodId: string | null, weekIndex: number | null, date: string, events: ScheduleEvent[] = [],
  periodRange?: Pick<Period, 'startDate' | 'endDate'> | null,
) {
  const store = useGrowthStore();
  const service = useMemo(() => new TaskApplicationService(store), [store]);
  const todayService = useMemo(() => new TodayExecutionService(store), [store]);
  const scope = useMemo(() => ({ store, journeyId, periodId, weekIndex, date }), [store, journeyId, periodId, weekIndex, date, periodRange?.startDate, periodRange?.endDate]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const generation = useRef(0);
  const active = useRef(false);
  type State = { scope: typeof scope; generation: number; tasks: Task[]; achievements: Achievement[];
    weeklyGoals: WeeklyGoal[]; personal_events: TodayPersonalEvent[]; taskPool: Task[]; executions: TaskExecution[]; loading: boolean; error: string | null };
  const empty = { tasks: [] as Task[], achievements: [] as Achievement[], weeklyGoals: [] as WeeklyGoal[], personal_events: [] as TodayPersonalEvent[], taskPool: [] as Task[], executions: [] as TaskExecution[] };
  const [state, setState] = useState<State>({ ...empty, scope, generation: 0, loading: true, error: null });

  const reload = useCallback(async () => {
    if (!active.current || currentScope.current !== scope) return;
    const token = ++generation.current;
    const valid = () => active.current && currentScope.current === scope && generation.current === token;
    setState(previous => ({ ...(previous.scope === scope ? previous : empty), scope, generation: token, loading: true, error: null }));
    try {
      if (!journeyId || !periodId || !weekIndex) {
        if (valid()) setState({ ...empty, scope, generation: token, loading: false, error: null });
        return;
      }
      const [tasks, achievements, weeklyGoals, personal_events, taskPool, executions] = await Promise.all([
        todayService.listTasks(periodId, date),
        service.listAchievements({ journeyId, periodId, occurredDate: date }),
        store.listWeeklyGoals(periodId, weekIndex),
        todayService.listPersonalEvents(periodId, date),
        periodRange ? (async () => {
          if (!store.scheduleEvents) throw new Error('当前数据源不支持读取任务时间块');
          const [allTasks, blocks] = await Promise.all([
            service.listTasks({ periodId }),
            new ScheduleEventApplicationService(store.scheduleEvents, store, store.courses).queryByDateRange({ periodId,
              startDate: periodRange.startDate, endDate: periodRange.endDate }),
          ]);
          return selectTaskPool(allTasks, blocks, periodId);
        })() : Promise.resolve([] as Task[]),
        service.listExecutions({ periodId }),
      ]);
      if (valid()) setState({ scope, generation: token, tasks, achievements, weeklyGoals, personal_events, taskPool, executions, loading: false, error: null });
    } catch (caught) {
      if (valid()) setState(previous => ({ ...previous, scope, generation: token, loading: false,
        error: caught instanceof Error ? caught.message : '读取今日执行数据失败' }));
    }
    // No unguarded finally: only the current request can settle loading.
  }, [scope, date, journeyId, periodId, service, store, todayService, weekIndex]);

  useFocusEffect(useCallback(() => {
    active.current = true;
    void reload();
    return () => {
      active.current = false; generation.current++;
      setState(previous => ({ ...previous, loading: true }));
    };
  }, [reload]));

  function assertReady() {
    if (!active.current || currentScope.current !== scope || state.scope !== scope || state.loading || state.error
      || state.generation !== generation.current || !journeyId || !periodId || !weekIndex) {
      throw new Error('今日数据尚未验证或已失效，请重新读取');
    }
  }
  const createTask = useCallback(async (input: CreateTaskInput, requestId?: string) => {
    assertReady();
    if (input.periodId !== periodId) throw new Error('任务不属于当前阶段');
    const task = await service.createTask(input, requestId);
    await reload();
    return task;
  }, [scope, state, reload, service]);
  const completeTask = useCallback(async (input: CompleteTaskInput) => {
    assertReady();
    if (!state.tasks.some(task => task.id === input.taskId && task.periodId === periodId)) throw new Error('任务不属于当前今日列表');
    const result = await service.completeTask(input);
    await reload();
    return result;
  }, [scope, state, reload, service]);

  const visible = state.scope === scope;
  const setPersonalCompleted = async (id: string, completed: boolean) => {
    assertReady();
    if (!state.personal_events.some(e => e.id === id) || !store.scheduleEvents) throw new Error('临时日程不属于当前今日列表');
    const service = new ScheduleEventApplicationService(store.scheduleEvents, store, store.courses);
    const saved = await service.update(periodId!, id, { completed });
    if (active.current && currentScope.current === scope && state.generation === generation.current) {
      setState(previous => ({ ...previous, personal_events: previous.personal_events.map(e => e.id === id ? { ...e, completed: saved.completed ?? false } : e) }));
    }
    await reload();
  };
  return { executions: visible ? state.executions : [], tasks: visible ? state.tasks : [], achievements: visible ? state.achievements : [],
    taskPool: visible ? state.taskPool : [],
    todos: visible ? combineTodayTodos(state.tasks, state.personal_events, events, date) : [],
    personal_events: visible ? state.personal_events : [], setPersonalCompleted,
    weeklyGoals: visible ? state.weeklyGoals : [], loading: !visible || !active.current || state.loading,
    error: visible ? state.error : null, createTask, completeTask, reload };
}
