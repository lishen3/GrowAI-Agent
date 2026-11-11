import type { AgentActionService, ActionResult } from '@/application/agent/AgentActionService';
import type { AgentContextService } from '@/application/agent/AgentContextService';
import type { AgentContext, BuildAgentContextInput } from '@/domain/agent/types';
import { calculateReplanImpact } from '@/domain/replan/ReplanImpactCalculator';
import { weeklyReplanProposalSchema, type WeeklyReplanProposal } from '@/domain/replan/types';

export interface ReplanGateway {
  replanWeekly(context: AgentContext, userMessage: string): Promise<WeeklyReplanProposal>;
}
export type ReplanExecution = { result: ActionResult; context?: AgentContext; refreshError?: string };

export class WeeklyReplanService {
  private input: BuildAgentContextInput | null = null;
  private busy = false;
  constructor(private readonly contexts: AgentContextService,
    private readonly gateway: ReplanGateway, private readonly actions: AgentActionService) {}

  async propose(input: BuildAgentContextInput, userMessage: string) {
    if (this.busy) throw new Error('请等待当前重排完成');
    if (!userMessage.trim()) throw new Error('请输入本周的新情况');
    this.busy = true;
    try {
      const context = await this.contexts.build(input);
      const proposal = weeklyReplanProposalSchema.parse(await this.gateway.replanWeekly(context, userMessage.trim()));
      const memoryIds = new Set(context.memories.map((memory) => memory.id));
      if (proposal.strategy.some((item) => item.basedOnMemoryIds.some((id) => !memoryIds.has(id)))) throw new Error('策略引用了不存在的记忆');
      proposal.expectedChanges = calculateReplanImpact(context, proposal.actions);
      this.actions.registerProposal({ message: proposal.summary, actions: proposal.actions }, context);
      this.input = { ...input };
      return { proposal, context };
    } finally { this.busy = false; }
  }

  reject(actionId: string) { return this.actions.rejectAction(actionId); }

  async confirm(actionId: string): Promise<ReplanExecution> {
    if (this.busy || !this.input) throw new Error('请等待当前重排完成或重新生成建议');
    this.busy = true;
    try {
      const result = await this.actions.executeApprovedAction(actionId, true);
      if (result.status !== 'EXECUTED') return { result };
      try { return { result, context: await this.contexts.build(this.input) }; }
      catch (error) { return { result, refreshError: error instanceof Error ? error.message : '执行成功，但刷新失败，请重新读取数据' }; }
    } finally { this.busy = false; }
  }
}
