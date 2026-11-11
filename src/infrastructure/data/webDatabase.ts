import { readSpaceMetadata } from './webLifecycle';
import { assignedWeeklyGoalId } from '@/domain/tasks/goalAssignment';
import { projectCoursesForWeek } from '@/domain/courses/projectCourseWeek';
import { sameManualPlacement, type ScheduleEvent } from '@/domain/scheduling/types';
import { goalPlanningSchema } from '@/domain/goals/progress';
import type { GrowthSnapshot, GrowthStore } from '@/application/data/GrowthStore';
import {
  initialPlanSeedSchema,
  mapInitialPlanSeed,
  planInitialPlanMerge,
} from '@/application/data/initialPlanSeed';
import type { CreateLongTermGoalInput, LongTermGoal } from '@/domain/goals/types';
import type { PeriodGoal, WeeklyGoal } from '@/domain/goals/planningTypes';
import type { GrowthJourney } from '@/domain/journey/types';
import { validatePeriodInput } from '@/domain/periods/rules';
import type { CreatePeriodInput, Period } from '@/domain/periods/types';
import { assertTaskCanComplete, assertTaskCanUpdate, validateCompleteTask, validateCreateTask, validateUpdateTask } from '@/domain/tasks/rules';
import type {
  Achievement,
  CompleteTaskInput,
  Task,
  TaskCompletionResult,
  TaskExecution,
} from '@/domain/tasks/types';
import { isIsoDate, todayIso } from '@/shared/date';
import { createWebMemoryRepository } from './webMemoryRepository';
import { assertDateOnlyBefore, dateOnlyUpdateSchema, sameTask } from '@/domain/tasks/dateOnly';
import { memorySchema, normalizeMemoryContent, type Memory } from '@/domain/memory/types';
import { reflectionSchema, type Reflection } from '@/domain/reflection/types';
import { repositoryRuntime, type RepositoryRuntime } from './repositoryRuntime';
import { requestRecordId } from '@/shared/id';
import { assertSameTaskCreation } from '@/domain/tasks/creationRequest';
import { timeOperationSchema, assertTimeTransition } from '@/domain/replan/timeOperation';
import { createWebScheduleEventRepository } from './webScheduleEventRepository';
import { scheduleEventSchema } from '@/domain/scheduling/types';
import { courseSchema } from '@/domain/courses/types';
import { createWebCourseRepository } from './webCourseRepository';
import { correctWebWeekStarts } from './mondayWeekMigration';
import { createWebPersonalConversion } from './webPersonalConversion';
import { createWebCategoryRepository, requireWebCategory } from './webCategoryRepository';
import { categorySchema, defaultCategories, legacyCategoryForId } from '@/domain/categories/types';
import { createWebConversationRepository } from './webConversationRepository';
import { BUSINESS_STORES, readTransactionMetadata, nextEpoch, beginBusinessWrite, initializePersonalLifecycle, markSnapshotImported, invalidatePendingOperations, bindBusinessConnection, type SeedPermit } from './webLifecycle';

const DATABASE_NAME = 'growai-pwa';
export const DEMO_DATABASE_NAME = 'growai-pwa-demo';
export type WebDataSpace = 'personal' | 'demo';
const DATABASE_VERSION = 10;
const demoStores = new WeakSet<GrowthStore>();
export function isDemoWebGrowthStore(store: GrowthStore): boolean { return demoStores.has(store); }
const STORES = [
  'journeys', 'periods', 'goals', 'periodGoals', 'weeklyGoals',
  'tasks', 'taskExecutions', 'achievements', 'memories', 'reflections', 'scheduleEvents', 'courses', 'categories',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertValidSnapshot(value: unknown): asserts value is GrowthSnapshot {
  if (!isRecord(value) || ![1, 2, 3, 4, 5, 6].includes(value.schemaVersion as number) || !isRecord(value.journey)) {
    throw new Error('这不是有效的 GrowAI 备份文件');
  }
  const { journey, periods, goals, periodGoals, weeklyGoals } = value;
  const categories = categorySchema.array().parse(value.categories ?? []);
  const registry = [...defaultCategories(String(journey.id)), ...categories];
  if (categories.some(row => row.journeyId !== journey.id) || new Set(categories.map(row => row.id)).size !== categories.length
    || new Set(categories.map(row => row.normalizedName)).size !== categories.length) throw new Error('备份分类作用域或唯一性无效');
  for (const rows of [value.tasks, value.achievements, value.scheduleEvents]) {
    if (Array.isArray(rows) && rows.some(row => row.categoryId && !registry.some(c => c.id === row.categoryId))) throw new Error('备份分类引用无效');
  }
  if (typeof journey.id !== 'string' || !Array.isArray(periods) || !Array.isArray(goals)
    || !Array.isArray(periodGoals) || !Array.isArray(weeklyGoals)) {
    throw new Error('备份文件缺少必要数据');
  }
  for (const goal of goals) { if (goal.planning !== undefined) { const planning=goalPlanningSchema.parse(goal.planning); if(planning.endDate && typeof goal.startDate==='string' && planning.endDate<goal.startDate)throw new Error('备份目标日期早于开始日期'); } }
  const validItem = (item: unknown) => isRecord(item) && typeof item.id === 'string';
  if (![...periods, ...goals, ...periodGoals, ...weeklyGoals].every(validItem)) {
    throw new Error('备份文件包含无效记录');
  }
  if (periods.some((period) => period.journeyId !== journey.id)
    || goals.some((goal) => goal.journeyId !== journey.id)) {
    throw new Error('备份文件中的成长旅程关系不一致');
  }
  for (const collection of [value.tasks, value.taskExecutions, value.achievements]) {
    if (collection !== undefined && (!Array.isArray(collection) || !collection.every(validItem))) {
      throw new Error('备份文件包含无效的执行记录');
    }
  }
  for (const collection of [periods, goals, periodGoals, weeklyGoals, value.tasks ?? [], value.taskExecutions ?? [], value.achievements ?? []]) {
    const rows = collection as { id: string }[];
    if (new Set(rows.map(row => row.id)).size !== rows.length)
      throw new Error('备份包含重复记录 ID，未恢复任何数据');
  }
  const tasks = (value.tasks ?? []) as Task[];
  const executions = (value.taskExecutions ?? []) as TaskExecution[];
  const achievements = (value.achievements ?? []) as Achievement[];
  if (journey.currentPeriodId && !periods.some(row => row.id === journey.currentPeriodId)
    || periodGoals.some(row => !periods.some(p => p.id === row.periodId)
      || row.longTermGoalId !== null && !goals.some(g => g.id === row.longTermGoalId))
    || weeklyGoals.some(row => !periods.some(p => p.id === row.periodId)
      || !periodGoals.some(g => g.id === row.periodGoalId && g.periodId === row.periodId))
    || tasks.some(row => !periods.some(p => p.id === row.periodId)
      || row.periodGoalId && !periodGoals.some(g => g.id === row.periodGoalId && g.periodId === row.periodId)
      || row.weeklyGoalId && !weeklyGoals.some(g => g.id === row.weeklyGoalId && g.periodId === row.periodId
        && (!row.periodGoalId || g.periodGoalId === row.periodGoalId)))
    || executions.some(row => !tasks.some(task => task.id === row.taskId))
    || achievements.some(row => row.journeyId !== journey.id || row.sourceType !== 'TASK'
      || !tasks.some(task => task.id === row.sourceId && task.periodId === row.periodId)))
    throw new Error('备份记录失去来源或目标/执行来源不一致，未恢复任何数据');
  const memories = zMemoryArray(value.memories);
  const events = scheduleEventSchema.array().parse(value.scheduleEvents ?? []);
  const courses = courseSchema.array().parse(value.courses ?? []);
  if (events.some((event) => event.source === 'SYSTEM')) throw new Error('ScheduleEvent 备份不能包含未持久化的系统投影');
  if (value.schemaVersion === 4 && !Array.isArray(value.scheduleEvents)) throw new Error('备份缺少排程数据');
  if (value.schemaVersion === 5 && !Array.isArray(value.courses)) throw new Error('备份缺少课程数据');
  if (new Set(courses.map((course) => course.id)).size !== courses.length || courses.some((course) => {
    const period = (value.periods as Period[]).find((p) => p.id === course.periodId);
    return !period || course.validFrom < period.startDate || course.validUntil > period.endDate;
  })) throw new Error('备份课程关联无效');
  if (new Set(events.map((e) => e.id)).size !== events.length || events.some((event) => {
    const period = (value.periods as Period[]).find((p) => p.id === event.periodId);
    return !period || event.date < period.startDate || event.date > period.endDate
      || event.taskId !== null && !(value.tasks as Task[] | undefined)?.some((t) => t.id === event.taskId && t.periodId === event.periodId);
  })) throw new Error('备份排程关联无效');
  const reflections = value.reflections === undefined ? [] : reflectionSchema.array().parse(value.reflections);
  const sources = new Set(reflections.map((item) => item.id));
  if (memories.some((item) => item.journeyId !== journey.id
    || (item.sourceType === 'REFLECTION' && !sources.has(item.sourceId!)))
    || reflections.some((item) => item.journeyId !== journey.id
      || !periods.some((period) => period.id === item.periodId))) {
    throw new Error('备份中的记忆或复盘来源不一致');
  }
}

function zMemoryArray(value: unknown): Memory[] { return value === undefined ? [] : memorySchema.array().parse(value); }

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务已取消'));
  });
}

export async function openWebDatabase(space: WebDataSpace = 'personal'): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) throw new Error('当前浏览器不支持 IndexedDB');
  if (space !== 'personal' && space !== 'demo') throw new Error('未知数据空间');

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(space === 'demo' ? DEMO_DATABASE_NAME : DATABASE_NAME, DATABASE_VERSION);
    let blocked = false;
    request.onblocked = () => { blocked = true; reject(new Error('数据库升级被其他标签页阻塞，请关闭旧标签页后重试；未清理数据')); };
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const transaction = request.transaction;
      if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: ['journeyId', 'id'] });
      if (!db.objectStoreNames.contains('conversations')) db.createObjectStore('conversations', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('timeOperations')) db.createObjectStore('timeOperations', { keyPath: 'operationId' });
      if (!db.objectStoreNames.contains('spaceMetadata')) {
        const metadata = db.createObjectStore('spaceMetadata', { keyPath: 'id' });
        // Lifecycle integration is a separate phase. Never enable production writes by migration alone.
        metadata.add({ id: 'time', databaseInstanceId: repositoryRuntime.createId('database'), epoch: '1', state: 'BLOCKED' });
      }
      if (!db.objectStoreNames.contains('scheduleEvents')) {
        const events = db.createObjectStore('scheduleEvents', { keyPath: 'id' });
        events.createIndex('periodDate', ['periodId', 'date']);
      }
      if (!db.objectStoreNames.contains('courses')) {
        const courses = db.createObjectStore('courses', { keyPath: 'id' });
        courses.createIndex('periodId', 'periodId');
        courses.createIndex('periodWeekday', ['periodId', 'weekday']);
      }
      if (space === 'demo' && !db.objectStoreNames.contains('demoMetadata')) {
        db.createObjectStore('demoMetadata', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('memories')) {
        const store = db.createObjectStore('memories', { keyPath: 'id' });
        store.createIndex('journeyId', 'journeyId');
        store.createIndex('dedup', ['journeyId', 'type', 'normalizedContent'], { unique: true });
      }
      if (!db.objectStoreNames.contains('reflections')) {
        const store = db.createObjectStore('reflections', { keyPath: 'id' });
        store.createIndex('journeyId', 'journeyId');
      }
      if (!db.objectStoreNames.contains('journeys')) db.createObjectStore('journeys', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('periods')) {
        const store = db.createObjectStore('periods', { keyPath: 'id' });
        store.createIndex('journeyId', 'journeyId');
      }
      if (!db.objectStoreNames.contains('goals')) {
        const store = db.createObjectStore('goals', { keyPath: 'id' });
        store.createIndex('journeyId', 'journeyId');
      }
      const periodGoalStore = db.objectStoreNames.contains('periodGoals')
        ? transaction!.objectStore('periodGoals')
        : db.createObjectStore('periodGoals', { keyPath: 'id' });
      if (!periodGoalStore.indexNames.contains('periodId')) {
        periodGoalStore.createIndex('periodId', 'periodId');
      }
      const weeklyGoalStore = db.objectStoreNames.contains('weeklyGoals')
        ? transaction!.objectStore('weeklyGoals')
        : db.createObjectStore('weeklyGoals', { keyPath: 'id' });
      if (!weeklyGoalStore.indexNames.contains('periodId')) {
        weeklyGoalStore.createIndex('periodId', 'periodId');
      }
      if (!weeklyGoalStore.indexNames.contains('periodWeek')) {
        weeklyGoalStore.createIndex('periodWeek', ['periodId', 'weekIndex']);
      }
      if (event.oldVersion < 2) {
        const periodGoalCursor = periodGoalStore.openCursor();
        periodGoalCursor.onsuccess = () => {
          const cursor = periodGoalCursor.result;
          if (!cursor) return;
          const value = cursor.value as Record<string, unknown>;
          cursor.update({
            ...value,
            category: value.category ?? 'CUSTOM',
            learningPath: value.learningPath ?? [],
            successCriteria: value.successCriteria ?? [],
          });
          cursor.continue();
        };
        const weeklyGoalCursor = weeklyGoalStore.openCursor();
        weeklyGoalCursor.onsuccess = () => {
          const cursor = weeklyGoalCursor.result;
          if (!cursor) return;
          const value = cursor.value as Record<string, unknown>;
          cursor.update({
            ...value,
            description: value.description ?? null,
            category: value.category ?? 'CUSTOM',
            priority: value.priority ?? 'B',
            targetValue: value.targetValue ?? null,
            targetUnit: value.targetUnit ?? null,
            successCriteria: value.successCriteria ?? [],
          });
          cursor.continue();
        };
      }
      if (!db.objectStoreNames.contains('tasks')) {
        const store = db.createObjectStore('tasks', { keyPath: 'id' });
        store.createIndex('periodId', 'periodId');
        store.createIndex('periodDate', ['periodId', 'plannedDate']);
        store.createIndex('weeklyGoalId', 'weeklyGoalId');
      }
      if (!db.objectStoreNames.contains('taskExecutions')) {
        const store = db.createObjectStore('taskExecutions', { keyPath: 'id' });
        store.createIndex('taskId', 'taskId');
      }
      if (!db.objectStoreNames.contains('achievements')) {
        const store = db.createObjectStore('achievements', { keyPath: 'id' });
        store.createIndex('journeyId', 'journeyId');
        store.createIndex('periodId', 'periodId');
        store.createIndex('source', ['sourceType', 'sourceId'], { unique: true });
      }
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      initializePersonalLifecycle(request.result).then(() => bindBusinessConnection(request.result))
        .then(() => correctWebWeekStarts(request.result))
        .then(() => bindBusinessConnection(request.result, true))
        .then(() => resolve(request.result), error => { request.result.close(); reject(error); });
    };
    request.onerror = () => reject(request.error ?? new Error('无法打开 GrowAI 本地数据库'));
  });
}

async function getAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).getAll()) as Promise<T[]>;
}

export async function ensureWebJourney(
  db: IDBDatabase,
  demoJourney?: { id: string; name: string },
  runtime: RepositoryRuntime = repositoryRuntime,
  permit?: SeedPermit,
): Promise<GrowthJourney> {
  if (demoJourney && db.name !== DEMO_DATABASE_NAME) throw new Error('演示旅程只能写入 Demo 数据库');
  if (!permit) await bindBusinessConnection(db);
  const existing = (await getAll<GrowthJourney>(db, 'journeys'))[0];
  if (existing) return existing;

  const now = runtime.now().toISOString();
  const journey: GrowthJourney = {
    id: demoJourney?.id ?? runtime.createId('journey'),
    name: demoJourney?.name ?? '我的成长旅程',
    currentPeriodId: null,
    startedAt: todayIso(runtime.now()),
    createdAt: now,
    updatedAt: now,
  };
  const transaction = await beginBusinessWrite(db, ['journeys'], permit);
  const done = transactionDone(transaction);
  // Re-read under the same write transaction: two bootstraps must not create two Journeys.
  const current = (await requestResult(transaction.objectStore('journeys').getAll()))[0] as GrowthJourney | undefined;
  if (!current) await requestResult(transaction.objectStore('journeys').add(journey));
  await done;
  if (current) return current;
  return journey;
}

export function createWebGrowthStore(db: IDBDatabase, runtime: RepositoryRuntime = repositoryRuntime, permit?: SeedPermit): GrowthStore {
  async function createTaskRecord(input: import('@/domain/tasks/types').CreateTaskInput, requestId?: string, slot?: Pick<ScheduleEvent, 'date' | 'startTime' | 'endTime'>): Promise<{ task: Task; event?: ScheduleEvent }> {
      validateCreateTask(input);
      const transaction = await beginBusinessWrite(db, ['periods', 'periodGoals', 'weeklyGoals', 'tasks', 'categories', ...(slot ? ['scheduleEvents','courses'] : [])], permit);
      const done = transactionDone(transaction);
      try {
        const stableId = requestId ? requestRecordId('task', requestId) : undefined;
        if (stableId) {
          const saved = await requestResult(transaction.objectStore('tasks').get(stableId)) as Task | undefined;
          if (saved) { assertSameTaskCreation(saved, input); const event = await schedule(saved, transaction, true, slot && requestId ? { slot, requestId } : undefined); await done; return { task: saved, event }; }
        }
        const [period, periodGoal, weeklyGoal] = await Promise.all([
          requestResult(transaction.objectStore('periods').get(input.periodId)) as Promise<Period | undefined>,
          input.periodGoalId
            ? requestResult(transaction.objectStore('periodGoals').get(input.periodGoalId)) as Promise<PeriodGoal | undefined>
            : Promise.resolve(undefined),
          input.weeklyGoalId
            ? requestResult(transaction.objectStore('weeklyGoals').get(input.weeklyGoalId)) as Promise<WeeklyGoal | undefined>
            : Promise.resolve(undefined),
        ]);
        if (!period) throw new Error('任务所属阶段不存在');
        if (input.periodGoalId && (!periodGoal || periodGoal.periodId !== input.periodId)) {
          throw new Error('阶段目标不属于任务阶段');
        }
        if (input.weeklyGoalId && (!weeklyGoal || weeklyGoal.periodId !== input.periodId)) {
          throw new Error('周目标不属于任务阶段');
        }
        if (input.periodGoalId && weeklyGoal && weeklyGoal.periodGoalId !== input.periodGoalId) {
          throw new Error('周目标与阶段目标关系不一致');
        }
        if (input.categoryId) await requireWebCategory(transaction, period.journeyId, input.categoryId);
        const now = runtime.now().toISOString();
        const task: Task = {
          ...(input.categoryId ? { categoryId: input.categoryId } : {}),
          id: stableId ?? runtime.createId('task'), periodId: input.periodId, periodGoalId: input.periodGoalId ?? null,
          weeklyGoalId: input.weeklyGoalId ?? null, title: input.title.trim(),
          description: input.description?.trim() || null, category: input.categoryId ? legacyCategoryForId(input.categoryId) : input.category, priority: input.priority,
          status: 'TODO', plannedDate: input.plannedDate ?? null, estimatedMinutes: input.estimatedMinutes ?? null,
          deadline: input.deadline ?? null, createdAt: now, startedAt: null, completedAt: null,
        };
        await requestResult(transaction.objectStore('tasks').add(task));
        const event = await schedule(task, transaction, false, slot && requestId ? { slot, requestId } : undefined);
        await done;
        return { task, event };
      } catch (error) {
        try { transaction.abort(); } catch { /* transaction already closed */ }
        await done.catch(() => undefined);
        throw error;
      }
    }
  async function schedule(task: Task, tx: IDBTransaction, replay: boolean, manualSlot?: { slot: Pick<ScheduleEvent, 'date' | 'startTime' | 'endTime'>; requestId: string }): Promise<ScheduleEvent | undefined> {
    if (!manualSlot) return undefined;
    const event = scheduleEventSchema.parse({ id: requestRecordId('schedule', manualSlot.requestId), periodId: task.periodId, taskId: task.id, type: 'TASK', source: 'USER', title: task.title, ...(task.categoryId ? {categoryId: task.categoryId}:{}), ...manualSlot.slot });
    const period = await requestResult(tx.objectStore('periods').get(task.periodId)) as Period;
    if (event.date < period.startDate || event.date > period.endDate) throw new Error('日期不属于当前阶段');
    const saved = await requestResult(tx.objectStore('scheduleEvents').get(event.id)) as ScheduleEvent | undefined;
    if (replay) { if (!saved || !sameManualPlacement(saved,event)) throw new Error('CREATION_REQUEST_CHANGED'); return saved; }
    const rows = await requestResult(tx.objectStore('scheduleEvents').getAll()) as ScheduleEvent[];
    const courses = await requestResult(tx.objectStore('courses').getAll()) as import('@/domain/courses/types').Course[];
    const fixed = projectCoursesForWeek(courses.filter(c=>c.periodId===task.periodId), event.date, event.date, { periodStart: period.startDate, weekStartsOn: period.weekStartsOn });
    if ([...rows.filter(r=>r.periodId===task.periodId),...fixed].some(r=>r.date===event.date && r.startTime<event.endTime && event.startTime<r.endTime)) throw new Error('时间冲突，创建失败');
    await requestResult(tx.objectStore('scheduleEvents').add(event)); return event;
  }
  const growthStore: GrowthStore = {
    async getContextVersion() {
      const meta = await readSpaceMetadata(db);
      if (meta.state !== 'READY') throw new Error('数据空间不可读取，请刷新后重试');
      return JSON.stringify([meta.databaseInstanceId, meta.epoch, meta.revision ?? '1']);
    },
    async deleteUnscheduledTask(taskId, periodId) {
      const tx = await beginBusinessWrite(db, ['tasks', 'scheduleEvents', 'taskExecutions', 'achievements', 'timeOperations']);
      const done = transactionDone(tx);
      try {
        const task = await requestResult(tx.objectStore('tasks').get(taskId)) as Task | undefined;
        if (!task || task.periodId !== periodId) throw new Error('任务不存在或阶段已变化');
        const [events, executions, achievements, operations] = await Promise.all(
          ['scheduleEvents', 'taskExecutions', 'achievements', 'timeOperations'].map(name => requestResult(tx.objectStore(name).getAll())),
        );
        const meta = await readTransactionMetadata(tx);
        let protectedOperation = false;
        for (const value of operations.filter(row => row.expectedTaskFacts?.id === taskId)) {
          const parsed = timeOperationSchema.safeParse(value);
          if (!parsed.success) { protectedOperation = true; continue; }
          const op = parsed.data;
          if (op.status === 'COMMITTED') { protectedOperation = true; continue; }
          if (op.status === 'PENDING') {
            const expired = runtime.now().getTime() >= Date.parse(op.expiresAt);
            const stale = op.scope.epoch !== meta.epoch || op.scope.databaseInstanceId !== meta.databaseInstanceId;
            if (!expired && !stale) { protectedOperation = true; continue; }
            const closed = timeOperationSchema.parse({ ...op, status: expired ? 'EXPIRED' : 'INVALID',
              decidedAt: new Date(Math.max(runtime.now().getTime(), Date.parse(op.createdAt))).toISOString() });
            assertTimeTransition(op, closed); await requestResult(tx.objectStore('timeOperations').put(closed));
          }
        }
        if (task.periodGoalId || task.weeklyGoalId || task.status === 'DONE' || task.completedAt
          || events.some(row => row.taskId === taskId) || executions.some(row => row.taskId === taskId)
          || achievements.some(row => row.sourceType === 'TASK' && row.sourceId === taskId)
          || protectedOperation) {
          throw new Error('该任务已有历史记录，无法删除');
        }
        await requestResult(tx.objectStore('tasks').delete(taskId)); await done;
      } catch (error) { try { tx.abort(); } catch {} await done.catch(() => undefined); throw error; }
    },
    async clearLocalData() {
      // Share the control/event/task locks with import and Time operations; never remove receipts.
      const stores = [...BUSINESS_STORES, 'timeOperations', ...(db.objectStoreNames.contains('demoMetadata') ? ['demoMetadata'] : [])];
      const tx = await beginBusinessWrite(db, stores); const done = transactionDone(tx);
      try {
        const meta = await readTransactionMetadata(tx);
        for (const name of BUSINESS_STORES) tx.objectStore(name).clear();
        await requestResult(tx.objectStore('spaceMetadata').put({ ...meta, epoch: nextEpoch(meta.epoch),
          suppressInitialSeed: true, source: db.name === DEMO_DATABASE_NAME ? 'imported' : 'personal' }));
        if (tx.objectStoreNames.contains('demoMetadata')) await requestResult(tx.objectStore('demoMetadata').put({ id: 'seed', version: 1, source: 'imported' }));
        await done;
      } catch (error) { try { tx.abort(); } catch {} await done.catch(() => undefined); throw error; }
    },
    categories: createWebCategoryRepository(db),
    conversations: createWebConversationRepository(db),
    convertPersonalEvent: createWebPersonalConversion(db),
    scheduleEvents: createWebScheduleEventRepository(db),
    courses: createWebCourseRepository(db),
    ...createWebMemoryRepository(db, runtime, permit),
    async getJourney() {
      return (await getAll<GrowthJourney>(db, 'journeys'))[0] ?? null;
    },

    async listPeriods(journeyId) {
      const periods = await requestResult(
        db.transaction('periods', 'readonly').objectStore('periods').index('journeyId').getAll(journeyId),
      ) as Period[];
      return periods.sort((a, b) => b.startDate.localeCompare(a.startDate) || b.createdAt.localeCompare(a.createdAt));
    },

    async listLongTermGoals(journeyId) {
      const goals = await requestResult(
        db.transaction('goals', 'readonly').objectStore('goals').index('journeyId').getAll(journeyId),
      ) as LongTermGoal[];
      const statusOrder: Record<LongTermGoal['status'], number> = {
        ACTIVE: 0, PLANNED: 1, PAUSED: 2, COMPLETED: 3, ARCHIVED: 4,
      };
      return goals
        .filter((goal) => goal.status !== 'ARCHIVED')
        .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.createdAt.localeCompare(b.createdAt));
    },

    async listPeriodGoals(periodId) {
      const goals = await requestResult(
        db.transaction('periodGoals', 'readonly').objectStore('periodGoals').index('periodId').getAll(periodId),
      ) as PeriodGoal[];
      const priorityOrder = { S: 0, A: 1, B: 2, C: 3 };
      return goals.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    },

    async listWeeklyGoals(periodId, weekIndex) {
      const store = db.transaction('weeklyGoals', 'readonly').objectStore('weeklyGoals');
      const request = weekIndex === undefined
        ? store.index('periodId').getAll(periodId)
        : store.index('periodWeek').getAll([periodId, weekIndex]);
      const goals = await requestResult(request) as WeeklyGoal[];
      const priorityOrder = { S: 0, A: 1, B: 2, C: 3 };
      return goals.sort((a, b) => a.weekIndex - b.weekIndex || priorityOrder[a.priority] - priorityOrder[b.priority]);
    },

    async createPeriod(input: CreatePeriodInput) {
      const errors = validatePeriodInput(input);
      if (errors.length) throw new Error(errors[0]);
      const now = runtime.now().toISOString();
      const period: Period = {
        id: runtime.createId('period'),
        journeyId: input.journeyId,
        name: input.name.trim(),
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate,
        status: 'PLANNED',
        description: input.description?.trim() || null,
        weekStartsOn: 1,
        currentWeekOverride: null,
        createdAt: now,
        completedAt: null,
      };
      const tx = await beginBusinessWrite(db, ['periods', 'journeys'], permit); const complete = transactionDone(tx);
      try {
        if (!await requestResult(tx.objectStore('journeys').get(input.journeyId))) throw new Error('成长旅程不存在');
        await requestResult(tx.objectStore('periods').add(period)); await complete;
      } catch (error) { try { tx.abort(); } catch {} await complete.catch(() => undefined); throw error; }
      return period;
    },

    async setCurrentPeriod(journeyId, periodId) {
      const transaction = await beginBusinessWrite(db, ['journeys', 'periods'], permit);
      const journeyStore = transaction.objectStore('journeys');
      const periodStore = transaction.objectStore('periods');
      const [journey, period] = await Promise.all([
        requestResult(journeyStore.get(journeyId)) as Promise<GrowthJourney | undefined>,
        requestResult(periodStore.get(periodId)) as Promise<Period | undefined>,
      ]);
      if (!journey || !period || period.journeyId !== journeyId) {
        transaction.abort();
        throw new Error('该阶段不属于当前成长旅程');
      }
      if (period.status === 'COMPLETED') {
        transaction.abort();
        throw new Error('已完成阶段不能重新设为当前阶段');
      }
      periodStore.put({ ...period, status: period.status === 'PLANNED' ? 'ACTIVE' : period.status });
      journeyStore.put({ ...journey, currentPeriodId: periodId, updatedAt: runtime.now().toISOString() });
      await transactionDone(transaction);
    },

    async createPeriodGoal(periodId, goalId, title) {
      if(!title.trim() || title.length>200)throw new Error('阶段目标名称应为1–200字');
      const tx=await beginBusinessWrite(db,['periods','goals','periodGoals'],permit);const done=transactionDone(tx);
      try {
        const period=await requestResult(tx.objectStore('periods').get(periodId)) as Period|undefined;
        const goal=await requestResult(tx.objectStore('goals').get(goalId)) as LongTermGoal|undefined;
        if(!period || !goal || period.journeyId!==goal.journeyId || goal.status==='ARCHIVED')throw new Error('阶段与长期方向归属无效');
        const row:PeriodGoal={id:runtime.createId('period-goal'),periodId,longTermGoalId:goalId,title:title.trim(),description:null,category:goal.category,priority:'B',status:'ACTIVE',successCriteria:[],learningPath:[],createdAt:runtime.now().toISOString(),completedAt:null};
        await requestResult(tx.objectStore('periodGoals').add(row));await done;return row;
      }catch(e){try{tx.abort();}catch{}await done.catch(()=>undefined);throw e;}
    },
    async assignTaskGoal(expected, periodGoalId) {
      const tx = await beginBusinessWrite(db, ['tasks', 'periodGoals', 'periods', 'goals', 'weeklyGoals'], permit); const done = transactionDone(tx);
      try {
        const tasks = tx.objectStore('tasks');
        const task = await requestResult(tasks.get(expected.id)) as Task | undefined;
        if (!task || task.periodId !== expected.periodId || task.periodGoalId !== expected.periodGoalId || task.weeklyGoalId !== expected.weeklyGoalId || task.status !== expected.status) throw new Error('任务归属已变化，请重新读取');
        if (periodGoalId) {
          const parent = await requestResult(tx.objectStore('periodGoals').get(periodGoalId)) as PeriodGoal | undefined;
          if (!parent || parent.periodId !== task.periodId || parent.status === 'CANCELLED') throw new Error('阶段目标归属无效');
          const period = await requestResult(tx.objectStore('periods').get(task.periodId)) as Period;
          if (parent.longTermGoalId) {
            const goal = await requestResult(tx.objectStore('goals').get(parent.longTermGoalId)) as LongTermGoal | undefined;
            if (!goal || goal.journeyId !== period.journeyId || goal.status === 'ARCHIVED') throw new Error('长期方向归属无效');
          }
        }
        const weekly = task.weeklyGoalId ? await requestResult(tx.objectStore('weeklyGoals').get(task.weeklyGoalId)) : null;
        const weeklyGoalId = assignedWeeklyGoalId(task,periodGoalId,weekly);
        await requestResult(tasks.put({ ...task, periodGoalId, weeklyGoalId })); await done;
      } catch (error) { try { tx.abort(); } catch {} await done.catch(() => undefined); throw error; }
    },
    async updateGoalPlanning(journeyId, goalId, input, expectedUpdatedAt) {
      const planning = goalPlanningSchema.parse(input);
      const tx = await beginBusinessWrite(db, ['goals', 'journeys'], permit); const done = transactionDone(tx);
      try {
        const goal = await requestResult(tx.objectStore('goals').get(goalId)) as LongTermGoal | undefined;
        if (!goal || goal.journeyId !== journeyId || goal.updatedAt !== expectedUpdatedAt) throw new Error('目标已变化，请重新读取');
        if (planning.endDate && planning.endDate < goal.startDate) throw new Error('目标结束日期不能早于开始日期');
        await requestResult(tx.objectStore('goals').put({ ...goal, planning, updatedAt: new Date(Math.max(runtime.now().getTime(), Date.parse(goal.updatedAt) + 1)).toISOString() })); await done;
      } catch (error) { try { tx.abort(); } catch {} await done.catch(() => undefined); throw error; }
    },
    async createLongTermGoal(input: CreateLongTermGoalInput) {
      if (!input.title.trim()) throw new Error('请输入长期目标名称');
      if (!input.targetDescription.trim()) throw new Error('请描述你真正想达到的状态');
      if (!isIsoDate(input.startDate)) throw new Error('开始日期格式应为 YYYY-MM-DD');
  if (input.planning) { const value = goalPlanningSchema.parse(input.planning); if (value.endDate && value.endDate < input.startDate) throw new Error('目标结束日期不能早于开始日期'); }
      const now = runtime.now().toISOString();
      const goal: LongTermGoal = {
        id: runtime.createId('goal'),
        journeyId: input.journeyId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        category: input.category,
        startDate: input.startDate,
        targetDescription: input.targetDescription.trim(),
        status: 'ACTIVE',
        ...(input.planning ? { planning: goalPlanningSchema.parse(input.planning) } : {}),
        createdAt: now,
        updatedAt: now,
      };
      const tx = await beginBusinessWrite(db, ['goals', 'journeys'], permit); const complete = transactionDone(tx);
      try {
        if (!await requestResult(tx.objectStore('journeys').get(input.journeyId))) throw new Error('成长旅程不存在');
        await requestResult(tx.objectStore('goals').add(goal)); await complete;
      } catch (error) { try { tx.abort(); } catch {} await complete.catch(() => undefined); throw error; }
      return goal;
    },

    async importInitialPlanSeed(input) {
      initialPlanSeedSchema.parse(input);
      const journey = (await getAll<GrowthJourney>(db, 'journeys'))[0];
      if (!journey) throw new Error('成长旅程不存在');
      const importedAt = runtime.now().toISOString();
      const mapped = mapInitialPlanSeed(input, journey.id, importedAt);
      const transaction = await beginBusinessWrite(db, ['journeys', 'periods', 'goals', 'periodGoals', 'weeklyGoals'], permit);
      const done = transactionDone(transaction);

      try {
        const journeyStore = transaction.objectStore('journeys');
        const periodStore = transaction.objectStore('periods');
        const goalStore = transaction.objectStore('goals');
        const periodGoalStore = transaction.objectStore('periodGoals');
        const weeklyGoalStore = transaction.objectStore('weeklyGoals');
        const [currentJourney, periods, longTermGoals, periodGoals, weeklyGoals] = await Promise.all([
          requestResult(journeyStore.get(journey.id)) as Promise<GrowthJourney | undefined>,
          requestResult(periodStore.getAll()) as Promise<Period[]>,
          requestResult(goalStore.getAll()) as Promise<LongTermGoal[]>,
          requestResult(periodGoalStore.getAll()) as Promise<PeriodGoal[]>,
          requestResult(weeklyGoalStore.getAll()) as Promise<WeeklyGoal[]>,
        ]);
        if (!currentJourney) throw new Error('成长旅程不存在');

        const plan = planInitialPlanMerge(mapped.data, {
          journey: currentJourney,
          periods,
          longTermGoals,
          periodGoals,
          weeklyGoals,
        });
        const writes: Promise<unknown>[] = [];
        for (const period of plan.periodsToInsert) writes.push(requestResult(periodStore.add(period)));
        for (const goal of plan.longTermGoalsToInsert) writes.push(requestResult(goalStore.add(goal)));
        for (const goal of plan.periodGoalsToInsert) writes.push(requestResult(periodGoalStore.add(goal)));
        for (const goal of plan.weeklyGoalsToInsert) writes.push(requestResult(weeklyGoalStore.add(goal)));
        if (plan.setAsCurrentPeriod) {
          writes.push(requestResult(journeyStore.put({
            ...currentJourney,
            currentPeriodId: plan.periodId,
            updatedAt: importedAt,
          })));
        }
        if (!writes.length) {
          // The write gate has queued a revision bump; a no-op seed must not publish it.
          transaction.abort(); await done.catch(() => undefined); return plan.result;
        }
        if (!permit) await invalidatePendingOperations(transaction);
        await Promise.all(writes);
        await done;
        return plan.result;
      } catch (error) {
        try { transaction.abort(); } catch { /* transaction already closed */ }
        await done.catch(() => undefined);
        throw error;
      }
    },

    async listTasks(query) {
      const store = db.transaction('tasks', 'readonly').objectStore('tasks');
      const tasks = await requestResult(
        query.plannedDate === undefined
          ? store.index('periodId').getAll(query.periodId)
          : store.index('periodDate').getAll([query.periodId, query.plannedDate]),
      ) as Task[];
      const priorityOrder = { S: 0, A: 1, B: 2, C: 3 };
      return tasks
        .filter((task) => (query.status === undefined || task.status === query.status)
          && (query.plannedFrom === undefined || (task.plannedDate !== null && task.plannedDate >= query.plannedFrom))
          && (query.plannedTo === undefined || (task.plannedDate !== null && task.plannedDate <= query.plannedTo)))
        .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
          || a.createdAt.localeCompare(b.createdAt));
    },

    async getTask(taskId) {
      return (await requestResult(
        db.transaction('tasks', 'readonly').objectStore('tasks').get(taskId),
      ) as Task | undefined) ?? null;
    },

    async createTask(input, requestId) { return (await createTaskRecord(input, requestId)).task; },
    async createScheduledTaskAtomic(input, slot, requestId) {
      const result = await createTaskRecord(input, requestId, slot);
      if (!result.event) throw new Error('时间块未保存');
      return { task: result.task, event: result.event };
    },

    async updateTaskDateOnly(input) {
      const validated = dateOnlyUpdateSchema.parse(input);
      const transaction = await beginBusinessWrite(db, ['tasks'], permit);
      const done = transactionDone(transaction);
      try {
        const store = transaction.objectStore('tasks');
        const task = (await requestResult(store.get(validated.taskId)) as Task | undefined) ?? null;
        assertDateOnlyBefore(task, validated);
        const expected = { ...task, plannedDate: validated.targetDate };
        await requestResult(store.put(expected));
        const result = await requestResult(store.get(task.id)) as Task;
        if (!result || !sameTask(result, expected)) throw new Error('DATE_ONLY_TRANSACTION_READBACK_MISMATCH');
        await done;
        return result;
      } catch (error) {
        try { transaction.abort(); } catch { /* transaction already closed */ }
        await done.catch(() => undefined);
        throw error;
      }
    },
    async updateTask(input) {
      validateUpdateTask(input);
      const transaction = await beginBusinessWrite(db, ['tasks', 'periods', 'categories'], permit);
      const done = transactionDone(transaction);
      try {
        const store = transaction.objectStore('tasks');
        const task = await requestResult(store.get(input.taskId)) as Task | undefined;
        if (!task) throw new Error('任务不存在');
        assertTaskCanUpdate(task);
        if (input.changes.categoryId && input.changes.categoryId !== task.categoryId) {
          const period = await requestResult(transaction.objectStore('periods').get(task.periodId));
          await requireWebCategory(transaction, period.journeyId, input.changes.categoryId);
        }
        const updated = { ...task, ...input.changes };
        if (input.changes.categoryId) updated.category = legacyCategoryForId(input.changes.categoryId);
        updated.title = updated.title.trim();
        await requestResult(store.put(updated));
        const result = await requestResult(store.get(task.id)) as Task;
        await done;
        return result;
      } catch (error) {
        try { transaction.abort(); } catch { /* transaction already closed */ }
        await done.catch(() => undefined);
        throw error;
      }
    },

    async completeTask(input: CompleteTaskInput): Promise<TaskCompletionResult> {
      validateCompleteTask(input);
      const transaction = await beginBusinessWrite(db, ['periods', 'tasks', 'taskExecutions', 'achievements'], permit);
      const done = transactionDone(transaction);
      try {
        const taskStore = transaction.objectStore('tasks');
        const executionStore = transaction.objectStore('taskExecutions');
        const achievementStore = transaction.objectStore('achievements');
        const task = await requestResult(taskStore.get(input.taskId)) as Task | undefined;
        if (!task) throw new Error('任务不存在');

        const previousAchievement = await requestResult(
          achievementStore.index('source').get(['TASK', task.id]),
        ) as Achievement | undefined;
        if (previousAchievement) {
          const executions = await requestResult(executionStore.index('taskId').getAll(task.id)) as TaskExecution[];
          const execution = executions.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
          if (!execution || task.status !== 'DONE') throw new Error('任务完成数据不一致，请先恢复数据');
          await done;
          return { task, execution, achievement: previousAchievement };
        }
        assertTaskCanComplete(task);
        const period = await requestResult(
          transaction.objectStore('periods').get(task.periodId),
        ) as Period | undefined;
        if (!period) throw new Error('任务所属阶段不存在');

        const now = runtime.now().toISOString();
        // Missing actual duration is unknown, not the planned estimate.
        const actualMinutes = input.actualMinutes ?? null;
        const execution: TaskExecution = {
          id: runtime.createId('execution'), taskId: task.id, startedAt: task.startedAt, completedAt: now,
          plannedMinutesSnapshot: task.estimatedMinutes, actualMinutes,
          completionNote: input.note?.trim() || null, learned: input.learned?.trim() || null,
          result: input.result?.trim() || null, createdAt: now,
        };
        const achievement: Achievement = {
          id: runtime.createId('achievement'), journeyId: period.journeyId, periodId: task.periodId,
          sourceType: 'TASK', sourceId: task.id, title: task.title, description: task.description,
          category: task.category, ...(task.categoryId ? { categoryId: task.categoryId } : {}), occurredAt: now, plannedDurationSnapshot: task.estimatedMinutes,
          actualDuration: actualMinutes, summary: input.note?.trim() || null,
          result: input.result?.trim() || null, isMilestone: false, createdAt: now,
        };
        const completedTask: Task = { ...task, status: 'DONE', completedAt: now };
        await Promise.all([
          requestResult(executionStore.add(execution)),
          requestResult(achievementStore.add(achievement)),
          requestResult(taskStore.put(completedTask)),
        ]);
        await done;
        return { task: completedTask, execution, achievement };
      } catch (error) {
        try { transaction.abort(); } catch { /* transaction already closed */ }
        await done.catch(() => undefined);
        throw error;
      }
    },

    async listTaskExecutions(taskId) {
      return requestResult(
        db.transaction('taskExecutions', 'readonly')
          .objectStore('taskExecutions').index('taskId').getAll(taskId),
      ) as Promise<TaskExecution[]>;
    },

    async listExecutions(query) {
      const transaction = db.transaction(['tasks', 'taskExecutions'], 'readonly');
      const [periodTasks, executions] = await Promise.all([
        requestResult(transaction.objectStore('tasks').index('periodId').getAll(query.periodId)) as Promise<Task[]>,
        requestResult(transaction.objectStore('taskExecutions').getAll()) as Promise<TaskExecution[]>,
      ]);
      const taskIds = new Set(periodTasks.map((task) => task.id));
      const filtered = executions.filter((execution) => {
        const date = todayIso(new Date(execution.completedAt));
        return taskIds.has(execution.taskId)
          && (query.completedFrom === undefined || date >= query.completedFrom)
          && (query.completedTo === undefined || date <= query.completedTo);
      }).sort((a, b) => b.completedAt.localeCompare(a.completedAt));
      return query.limit === undefined ? filtered : filtered.slice(0, query.limit);
    },

    async listAchievements(query) {
      const store = db.transaction('achievements', 'readonly').objectStore('achievements');
      const achievements = await requestResult(
        query.periodId === undefined
          ? store.index('journeyId').getAll(query.journeyId)
          : store.index('periodId').getAll(query.periodId),
      ) as Achievement[];
      return achievements
        .filter((item) => item.journeyId === query.journeyId
          && (query.occurredDate === undefined || todayIso(new Date(item.occurredAt)) === query.occurredDate)
          && (query.occurredFrom === undefined || todayIso(new Date(item.occurredAt)) >= query.occurredFrom)
          && (query.occurredTo === undefined || todayIso(new Date(item.occurredAt)) <= query.occurredTo))
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, query.limit ?? Number.MAX_SAFE_INTEGER);
    },

    async exportSnapshot() {
      const transaction = db.transaction([...STORES, 'spaceMetadata'], 'readonly');
      const complete = transactionDone(transaction);
      const [values, metadata] = await Promise.all([
        Promise.all(STORES.map(name => requestResult(transaction.objectStore(name).getAll()))), readTransactionMetadata(transaction),
      ]);
      await complete;
      if (metadata.state !== 'READY') throw new Error('数据空间未就绪，不能导出部分初始化数据');
      const rows = Object.fromEntries(STORES.map((name, index) => [name, values[index]]));
      const journey = rows.journeys[0] as GrowthJourney | undefined;
      if (!journey) throw new Error('成长旅程不存在');
      return {
        schemaVersion: 6, categories: [...new Map([...defaultCategories(journey.id),
          ...rows.categories.filter(row => row.journeyId === journey.id)].map(row => [row.id, row])).values()],
        exportedAt: runtime.now().toISOString(), journey, periods: rows.periods, goals: rows.goals,
        scheduleEvents: rows.scheduleEvents, courses: rows.courses,
        periodGoals: rows.periodGoals, weeklyGoals: rows.weeklyGoals, tasks: rows.tasks,
        taskExecutions: rows.taskExecutions, achievements: rows.achievements,
        memories: rows.memories.filter(row => row.journeyId === journey.id).map(row => row.record),
        reflections: rows.reflections.filter(row => row.journeyId === journey.id),
      };
    },

    async importSnapshot(snapshot) {
      assertValidSnapshot(snapshot);
      if (permit) throw new Error('SEED_CANNOT_RESTORE_SNAPSHOT');
      const transaction = await beginBusinessWrite(db, [...STORES, 'timeOperations', ...(db.objectStoreNames.contains('demoMetadata') ? ['demoMetadata'] : [])]);
      const done = transactionDone(transaction);
      try {
        await markSnapshotImported(transaction);
        const existingEvents = await requestResult(transaction.objectStore('scheduleEvents').getAll());
        if (snapshot.schemaVersion < 4 && existingEvents.length) throw new Error('旧备份不含排程；请先导出当前版本，不能覆盖现有排程');
        const existingCourses = await requestResult(transaction.objectStore('courses').getAll());
        if (snapshot.schemaVersion < 5 && existingCourses.length) throw new Error('旧备份不含课程；请先导出当前版本，不能覆盖现有课程');
        const memoryStore = transaction.objectStore('memories');
        const reflectionStore = transaction.objectStore('reflections');
        const [existingMemories, existingReflections] = await Promise.all([
          requestResult(memoryStore.getAll()),
          requestResult(reflectionStore.getAll()) as Promise<Reflection[]>,
        ]);
        // Keep history, and reject restores that would orphan its journey/period.
        if (existingMemories.some((item) => item.journeyId !== snapshot.journey.id)
          || existingReflections.some((item) => item.journeyId !== snapshot.journey.id
            || !snapshot.periods.some((period) => period.id === item.periodId))) {
          throw new Error('备份会使现有记忆或复盘失去来源，已取消恢复');
        }
        for (const storeName of STORES) {
          if (storeName !== 'memories' && storeName !== 'reflections') transaction.objectStore(storeName).clear();
        }
        transaction.objectStore('journeys').put(snapshot.journey);
        for (const category of snapshot.categories ?? []) transaction.objectStore('categories').put(category);
        for (const period of snapshot.periods) transaction.objectStore('periods').put({ ...period, weekStartsOn: 1 });
        for (const goal of snapshot.goals) transaction.objectStore('goals').put(goal);
        for (const goal of snapshot.periodGoals ?? []) transaction.objectStore('periodGoals').put(goal);
        for (const goal of snapshot.weeklyGoals ?? []) transaction.objectStore('weeklyGoals').put(goal);
        for (const task of snapshot.tasks ?? []) transaction.objectStore('tasks').put(task);
        for (const event of snapshot.scheduleEvents ?? []) transaction.objectStore('scheduleEvents').put(event);
        for (const course of snapshot.courses ?? []) transaction.objectStore('courses').put(course);
        for (const execution of snapshot.taskExecutions ?? []) transaction.objectStore('taskExecutions').put(execution);
        for (const achievement of snapshot.achievements ?? []) transaction.objectStore('achievements').put(achievement);
        const reflectionIds = new Set(existingReflections.map((item) => item.id));
        for (const reflection of snapshot.reflections ?? []) {
          if (!reflectionIds.has(reflection.id)) {
            await requestResult(reflectionStore.add(reflection));
            reflectionIds.add(reflection.id);
          }
        }
        for (const memory of snapshot.memories ?? []) {
          const normalizedContent = normalizeMemoryContent(memory.content);
          const [byId, duplicate] = await Promise.all([
            requestResult(memoryStore.get(memory.id)),
            requestResult(memoryStore.index('dedup').get([memory.journeyId, memory.type, normalizedContent])),
          ]);
          if (!byId && !duplicate) await requestResult(memoryStore.add({
            id: memory.id, journeyId: memory.journeyId, type: memory.type, normalizedContent, record: memory,
          }));
        }
        await done;
      } catch (error) {
        try { transaction.abort(); } catch { /* already closed */ }
        await done.catch(() => undefined);
        throw error;
      }
    },
  };
  if (db.name === DEMO_DATABASE_NAME) demoStores.add(growthStore);
  return growthStore;
}
