import type { AgentContextService } from '@/application/agent/AgentContextService';
import type { GrowthStore } from '@/application/data/GrowthStore';
import { MemoryApplicationService } from '@/application/memory/MemoryApplicationService';
import type { AgentContext, BuildAgentContextInput } from '@/domain/agent/types';
import { weeklyReflectionDraftSchema, type Reflection, type WeeklyReflectionDraft } from '@/domain/reflection/types';
import { createId } from '@/shared/id';
import { validateGrowthReflection } from '@/domain/reflection/evidence';
import { normalizeMemoryContent } from '@/domain/memory/types';
import { ReflectionGenerationFailure } from './ReflectionGenerationFailure';

export interface ReflectionGateway {
  reflectWeekly(context: AgentContext, userMessage?: string): Promise<WeeklyReflectionDraft>;
  startReflection?(context: AgentContext, requestId: string): Promise<WeeklyReflectionDraft>;
  recoverReflection?(context: AgentContext, requestId: string): Promise<{ context: AgentContext; draft: WeeklyReflectionDraft }>;
  resumeReflection?(context: AgentContext, requestId: string): Promise<WeeklyReflectionDraft>;
}
export interface ReflectionStore {
  saveReflection(reflection: Reflection): Promise<void>;
  getReflection(journeyId: string, reflectionId: string): Promise<Reflection | null>;
  listReflections(journeyId: string): Promise<Reflection[]>;
}

// Check using the connection that will save the result; a long inference can outlive its original Store.
export async function hasDuplicateMemoryCandidate(store: GrowthStore, journeyId: string, draft: Pick<Reflection, 'memoryCandidates'>) {
  if (!draft.memoryCandidates.length) return false;
  const existing = new Set((await store.listMemories(journeyId)).map(row => normalizeMemoryContent(row.content)));
  return draft.memoryCandidates.some(row => existing.has(normalizeMemoryContent(row.content)));
}

export class WeeklyReflectionService {
  constructor(private readonly contextService: AgentContextService,
    private readonly gateway: ReflectionGateway, private readonly store: GrowthStore) {}

  async generate(input: BuildAgentContextInput, requestId?: string, resume = false, saveWithConversation = false): Promise<Reflection> {
    if (resume && (!requestId || (!this.gateway.resumeReflection && !this.gateway.recoverReflection))) throw new Error('当前接口不支持读取原请求，未重新生成');
    const reflectionId = requestId ? `reflection_${requestId}` : createId('reflection');
    if (requestId) {
      const existing = await this.store.getReflection(input.journeyId, reflectionId);
      if (existing) {
        const { period, window } = await this.contextService.resolveWeek(input);
        if (existing.periodId !== period.id || existing.startDate !== window.startDate || existing.endDate !== window.endDate) throw new Error('原复盘不属于当前阶段或周');
        return existing;
      }
    }
    const started=performance.now(), metrics:Record<string,number>={};let mark=started;
    try {
    let context = await this.contextService.buildReflection(input);
    metrics.context_read_ms=performance.now()-mark;mark=performance.now();
    let draft: WeeklyReflectionDraft;
    let reviewSnapshot: ReturnType<typeof validateGrowthReflection>;
    try {
    if (resume && this.gateway.recoverReflection) {
      const recovered = await this.gateway.recoverReflection(context, requestId!);
      const original = recovered.context;
      if (original.journey.id !== context.journey.id || original.currentPeriod.id !== context.currentPeriod.id
        || original.currentWeek.windowStart !== context.currentWeek.windowStart || original.currentWeek.windowEnd !== context.currentWeek.windowEnd) throw new Error('原复盘快照作用域不匹配');
      context = original;
      draft = weeklyReflectionDraftSchema.parse(recovered.draft);
    } else draft = weeklyReflectionDraftSchema.parse(await (resume ? this.gateway.resumeReflection!(context, requestId!)
      : requestId && this.gateway.startReflection ? this.gateway.startReflection(context, requestId) : this.gateway.reflectWeekly(context)));
    metrics.model_request_ms=performance.now()-mark;mark=performance.now();
    reviewSnapshot = validateGrowthReflection(context, draft);
    } catch (error) {
      // Only generation/validation failures get a facts-only display. Storage
      // failures must retain their own error and must never be called success.
      throw new ReflectionGenerationFailure(context, error);
    }
    metrics.evidence_validation_ms=performance.now()-mark;
    if ((!saveWithConversation || !this.store.conversations?.savesReflectionOnAppend)
      && await hasDuplicateMemoryCandidate(this.store, input.journeyId, draft)) throw new Error('复盘记忆候选与已有记忆重复，未保存');
    const reflection: Reflection = {
      ...draft, reviewSnapshot, id: reflectionId, journeyId: context.journey.id,
      periodId: context.currentPeriod.id, type: 'WEEKLY',
      startDate: context.currentWeek.windowStart, endDate: context.currentWeek.windowEnd,
      createdAt: new Date().toISOString(),
    };
    mark=performance.now();
    if (!saveWithConversation || !this.store.conversations?.savesReflectionOnAppend) await this.store.saveReflection(reflection);
    metrics.persistence_ms=performance.now()-mark;
    return reflection;
    } finally {console.debug('GrowAI reflection performance',{...metrics,total_duration_ms:performance.now()-started});}
  }

  /** Viewing history never invokes the gateway or creates another reflection. */
  async latest(input: BuildAgentContextInput): Promise<Reflection | null> {
    const { period, window } = await this.contextService.resolveWeek(input);
    return (await this.store.listReflections(input.journeyId)).filter(row => row.journeyId === input.journeyId
      && row.periodId === period.id && row.startDate === window.startDate
      && row.endDate === window.endDate).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }

  async confirmCandidate(journeyId: string, reflectionId: string, index: number) {
    const reflection = await this.store.getReflection(journeyId, reflectionId);
    const candidate = Number.isInteger(index) && index >= 0 ? reflection?.memoryCandidates[index] : undefined;
    if (!candidate) throw new Error('记忆候选不存在');
    return new MemoryApplicationService(this.store).createMemory({
      type: candidate.type, content: candidate.content, evidence: candidate.evidence, confidence: candidate.confidence,
      journeyId, sourceType: 'REFLECTION', sourceId: reflectionId,
    });
  }
}
