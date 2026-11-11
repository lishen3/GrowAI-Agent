import type { GrowthStore } from '@/application/data/GrowthStore';
import { AgentContextService } from '@/application/agent/AgentContextService';
import { isIsoDate } from '@/shared/date';
import { taskSnapshotSchema } from '@/domain/tasks/dateOnly';
import { planningPreviewSchema, PlanningPreviewError, type DemoPlanningSnapshot, type DemoPlanningSession, type PlanningPreview } from '@/domain/replan/planningPreview';

export interface DemoPlanningGateway {
  preview(snapshot: DemoPlanningSnapshot, userMessage: string, allowedDate: string): Promise<PlanningPreview>;
}
export class DemoPlanningService {
  constructor(private readonly store: GrowthStore, private readonly gateway: DemoPlanningGateway,
    private readonly clock: () => Date = () => new Date(), private readonly getSession?: () => DemoPlanningSession | undefined) {}

  private day() { return new Date(this.clock().getTime() + 8 * 3600000).toISOString().slice(0, 10); }

  async load(demoActive: boolean): Promise<DemoPlanningSnapshot> {
    if (!demoActive) throw new PlanningPreviewError('先在“我的”进入独立 Demo 环境', true, 'DEMO_REQUIRED', 'PREFLIGHT');
    const journey = await this.store.getJourney();
    if (journey?.id !== 'demo_journey' || journey.currentPeriodId !== 'demo_period') {
      throw new PlanningPreviewError('当前数据不是标准 Demo，请检查演示环境', true, 'DEMO_SCOPE_INVALID', 'PREFLIGHT');
    }
    const runtimeDate = this.day();
    const context = await new AgentContextService(this.store).build({ journeyId: journey.id, date: runtimeDate });
    if (context.currentPeriod.status !== 'ACTIVE' || runtimeDate < context.currentWeek.windowStart
      || runtimeDate > context.currentWeek.windowEnd || runtimeDate < context.currentPeriod.startDate || runtimeDate > context.currentPeriod.endDate) {
      throw new PlanningPreviewError('Demo 周期已失效，请从设置重置演示数据', true, 'WINDOW_EXPIRED', 'PREFLIGHT');
    }
    const tasks = await Promise.all(context.tasks.map(async (fact) => {
      const task = taskSnapshotSchema.parse(await this.store.getTask(fact.id));
      if (task.periodId !== context.currentPeriod.id || Object.entries(fact).some(([key, value]) => task[key as keyof typeof task] !== value)) {
        throw new PlanningPreviewError('读取期间任务发生变化，请重新读取', true, 'FACTS_CHANGED', 'PREFLIGHT');
      }
      return task;
    }));
    return { context, tasks, runtimeDate, session: this.getSession?.() };
  }

  async generate(demoActive: boolean, allowedDate: string) {
    const snapshot = await this.load(demoActive); // Fresh facts for each explicit click, not the UI's old snapshot.
    if (!isIsoDate(allowedDate) || allowedDate < snapshot.runtimeDate
      || allowedDate < snapshot.context.currentWeek.windowStart || allowedDate > snapshot.context.currentWeek.windowEnd
      || allowedDate < snapshot.context.currentPeriod.startDate || allowedDate > snapshot.context.currentPeriod.endDate) {
      throw new PlanningPreviewError('请选择今天或之后、且在当前 Demo 周内的 ISO 日期', true, 'INVALID_ALLOWED_DATE', 'PREFLIGHT');
    }
    const message = `最近英语任务压力比较大，帮我调整一下计划。用户明确允许尝试日期：${allowedDate}。只调整本周未完成任务的日期，不改分钟数、目标、优先级或内容；此日期不代表容量已验证。`;
    const preview = planningPreviewSchema.parse(await this.gateway.preview(structuredClone(snapshot), message, allowedDate));
    if (snapshot.runtimeDate !== this.day()) throw new PlanningPreviewError('运行日期已改变，请重新读取', true, 'DATE_CHANGED', 'READBACK');
    const ids = new Set(snapshot.tasks.map((task) => task.id));
    const memoryIds = new Set(snapshot.context.memories.map((memory) => memory.id));
    if (preview.planner.strategy.some((item) => item.basedOnMemoryIds.some((id) => !memoryIds.has(id)))) throw new Error('Planner 引用了不存在的 Memory');
    const candidates = new Set(preview.candidates.candidateTaskIds);
    if (candidates.size !== preview.candidates.candidateTaskIds.length
      || Object.keys(preview.candidates.allowedTargetDates).some((id) => !candidates.has(id))
      || snapshot.tasks.some((task) => candidates.has(task.id) === Object.hasOwn(preview.candidates.rejectedReasons, task.id))) {
      throw new Error('候选与排除事实不一致');
    }
    for (const id of preview.candidates.candidateTaskIds) {
      const task = snapshot.tasks.find((task) => task.id === id);
      if (!task || !['TODO', 'DELAYED'].includes(task.status)
        || !preview.candidates.allowedTargetDates[id]?.length
        || preview.candidates.allowedTargetDates[id].some((date) => date !== allowedDate || date === task.plannedDate)) throw new Error('候选事实非法');
    }
    if (Object.keys(preview.candidates.rejectedReasons).some((id) => !ids.has(id))) throw new Error('候选排除结果包含不存在的任务');
    const seen = new Set<string>();
    for (const action of preview.draft.actions) {
      const id = action.arguments.taskId;
      if (seen.has(id) || !preview.candidates.candidateTaskIds.includes(id) || action.arguments.changes.plannedDate !== allowedDate) throw new Error('返回了越权日期动作');
      seen.add(id);
    }
    return { snapshot, preview };
  }
}
