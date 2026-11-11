import { addDays, startOfDay, startOfWeek } from 'date-fns';
import { initialPlanSeedSchema, type InitialPlanSeed } from '@/application/data/initialPlanSeed';
import { TaskApplicationService } from '@/application/tasks/TaskApplicationService';
import { MemoryApplicationService } from '@/application/memory/MemoryApplicationService';
import { todayIso } from '@/shared/date';
import type { RepositoryRuntime } from './repositoryRuntime';
import { createWebGrowthStore, DEMO_DATABASE_NAME, ensureWebJourney } from './webDatabase';
import { requestResult } from './webMemoryRepository';
import { beginDemoReset, finishDemoReset, readSpaceMetadata, type SpaceMetadata } from './webLifecycle';

export const DEMO_JOURNEY_ID = 'demo_journey';
export const DEMO_PERIOD_ID = 'demo_period';
export const DEMO_MEMORY_ID = 'demo_memory_busy_week_preference';

export function buildDemoPlan(now: Date): InitialPlanSeed {
  if (!Number.isFinite(now.getTime())) throw new Error('无效的演示日期');
  const startDate = todayIso(startOfWeek(now, { weekStartsOn: 1 }));
  const endDate = todayIso(addDays(startOfWeek(now, { weekStartsOn: 1 }), 6));
  const categories = ['ENGLISH', 'PROFESSIONAL', 'PROJECT'] as const;
  const titles = ['英语能力', '专业学习', 'GrowAI 项目'];
  return initialPlanSeedSchema.parse({
    schemaVersion: 1, generatedFor: 'GrowAI',
    period: { id: DEMO_PERIOD_ID, name: '大三上 · Demo 当周', type: 'SEMESTER',
      startDate, endDate, totalTeachingWeeks: 1, status: 'ACTIVE',
      description: '演示样本：仅用运行当天所在周作为阶段窗口，不是个人真实学期。' },
    longTermGoals: categories.map((category, index) => ({
      id: `demo_goal_${category}`, title: titles[index], category, priority: 'A', status: 'ACTIVE',
      startDate, targetDescription: index === 0 ? '能够听懂英语，并自然、流畅地用英语交流。' : `持续推进${titles[index]}`,
    })),
    periodGoals: categories.map((category, index) => ({
      id: `demo_period_goal_${category}`, periodId: DEMO_PERIOD_ID, longTermGoalId: `demo_goal_${category}`,
      title: index === 0 ? '保持英语听读训练' : titles[index], category, priority: 'A', status: 'ACTIVE',
      targetDescription: '演示样本：在繁忙周继续推进目标。',
    })),
    weeklyPlans: [{ weekNumber: 1, startDate, endDate, theme: '比赛打乱计划后的动态调整',
      goals: categories.map((category, index) => ({
        id: `demo_weekly_goal_${category}`, periodGoalId: `demo_period_goal_${category}`,
        title: index === 0 ? '本周英语学习 120min' : titles[index], category, priority: 'A',
        targetValue: index === 0 ? 120 : 60, targetUnit: 'min', status: 'ACTIVE',
      })),
    }], adaptiveRules: [],
  });
}

function assertDemoDatabase(db: IDBDatabase) {
  if (db.name !== DEMO_DATABASE_NAME) throw new Error('Reset Demo 拒绝操作个人数据库');
}

export async function resetDemoDatabase(db: IDBDatabase, now = new Date(), expected?: SpaceMetadata): Promise<void> {
  assertDemoDatabase(db);
  const plan = buildDemoPlan(now); // Validate before any destructive demo-only operation.
  const seedTime = startOfDay(now);
  const counters = new Map<string, number>();
  const runtime: RepositoryRuntime = {
    now: () => new Date(seedTime),
    createId: (prefix) => {
      const count = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, count);
      return prefix === 'memory' && count === 1 ? DEMO_MEMORY_ID : `demo_${prefix}_${count}`;
    },
  };
  const permit = await beginDemoReset(db, expected);
  // On failure the durable RESETTING state remains; only an explicit new Reset may recover.
  await ensureWebJourney(db, { id: DEMO_JOURNEY_ID, name: '大三上成长计划' }, runtime, permit);
  const store = createWebGrowthStore(db, runtime, permit);
  await store.importInitialPlanSeed(plan);
  const tasks = new TaskApplicationService(store);
  const samples = [
    { title: '英语词汇复习', category: 'ENGLISH', actual: 35 },
    { title: 'Python 练习', category: 'PROFESSIONAL', actual: 50 },
    { title: '英语听力', category: 'ENGLISH', actual: null },
    { title: '英语阅读', category: 'ENGLISH', actual: null },
    { title: 'GrowAI 项目任务', category: 'PROJECT', actual: null },
  ] as const;
  for (const sample of samples) {
    const task = await tasks.createTask({ periodId: DEMO_PERIOD_ID,
      periodGoalId: `demo_period_goal_${sample.category}`, weeklyGoalId: `demo_weekly_goal_${sample.category}`,
      title: sample.title, category: sample.category, priority: 'A', estimatedMinutes: 60,
      plannedDate: todayIso(now), description: '演示样本：非个人学习记录。' });
    if (sample.actual !== null) await tasks.completeTask({ taskId: task.id, actualMinutes: sample.actual,
      note: '演示样本：模拟的历史执行记录，不代表现场学习或 AI 执行。', result: '演示样本：已完成练习' });
  }
  await new MemoryApplicationService(store).createMemory({ journeyId: DEMO_JOURNEY_ID,
    type: 'PREFERENCE', sourceType: 'USER', sourceId: null, confidence: 'HIGH',
    content: '繁忙周希望保留英语学习，优先缩短单次训练，而不是取消英语目标。',
    evidence: '演示样本：预置的用户陈述；HIGH 指偏好陈述明确，不代表策略有效性已验证。' });
  await finishDemoReset(db, permit, now);
}

export async function ensureDemoDatabase(db: IDBDatabase, now = new Date()): Promise<void> {
  assertDemoDatabase(db);
  const lifecycle = await readSpaceMetadata(db);
  const metadata = await requestResult(db.transaction('demoMetadata', 'readonly').objectStore('demoMetadata').get('seed'));
  if (lifecycle.state === 'BLOCKED' && lifecycle.epoch === '1' && lifecycle.mutationOwner === null && !metadata) {
    await resetDemoDatabase(db, now, lifecycle); return;
  }
  if (lifecycle.state !== 'READY') throw new Error('Demo 初始化未完成，请显式重建演示数据；不会影响个人数据');
  if (lifecycle.source === 'imported') return;
  // Existing Demo records are user-editable: date changes must not silently reset them.
  if (metadata?.version !== 1) throw new Error('Demo 版本需要显式恢复，不会自动清空已有记录');
}
