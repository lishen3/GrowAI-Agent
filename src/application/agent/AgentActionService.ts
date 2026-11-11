import type { GrowthStore } from '@/application/data/GrowthStore';
import { TaskApplicationService } from '@/application/tasks/TaskApplicationService';
import type { AgentContext, BuildAgentContextInput } from '@/domain/agent/types';
import {
  agentActionProposalSchema, authorizationSchema,
  type AgentAction, type AgentActionProposal, type ActionAuthorization, type ActionStatus,
} from '@/domain/agent/actions';
import type { Task } from '@/domain/tasks/types';
import { AgentContextService } from './AgentContextService';
import { createToolRegistry } from './tools';
import { validateReplanActions } from '@/domain/replan/policy';

export interface AgentActionGateway {
  proposeActions(context: AgentContext, userMessage: string): Promise<AgentActionProposal>;
  authorizeAction(actionId: string, approval: boolean): Promise<ActionAuthorization>;
}
export type ActionResult = { actionId: string; status: ActionStatus; task?: Task; error?: string };
type Pending = { action: AgentAction; periodId: string; result: ActionResult; replanContext?: AgentContext };

export class AgentActionService {
  private readonly pending = new Map<string, Pending>();
  private readonly tools;
  private busy = false;

  constructor(private readonly store: GrowthStore, private readonly gateway: AgentActionGateway) {
    this.tools = createToolRegistry(new TaskApplicationService(store));
  }

  async propose(input: BuildAgentContextInput, userMessage: string): Promise<AgentActionProposal> {
    if (this.busy) throw new Error('请等待当前操作完成');
    if (!userMessage.trim()) throw new Error('请输入需求');
    this.busy = true;
    try {
      const context = await new AgentContextService(this.store).build(input);
      return this.retainProposal(await this.gateway.proposeActions(context, userMessage.trim()), context);
    } finally { this.busy = false; }
  }

  registerProposal(proposal: AgentActionProposal, context: AgentContext): AgentActionProposal {
    if (this.busy) throw new Error('请等待当前操作完成');
    return this.retainProposal(proposal, context, true);
  }

  private retainProposal(input: AgentActionProposal, context: AgentContext, replan = false): AgentActionProposal {
    const proposal = agentActionProposalSchema.parse(input);
    if (new Set(proposal.actions.map((action) => action.id)).size !== proposal.actions.length) throw new Error('操作 ID 重复');
    if (replan) validateReplanActions(context, proposal.actions);
    this.pending.clear();
    for (const action of proposal.actions) this.pending.set(action.id, {
      action: structuredClone(action), periodId: context.currentPeriod.id,
      replanContext: replan ? structuredClone(context) : undefined,
      result: { actionId: action.id, status: 'PROPOSED' },
    });
    return proposal;
  }

  rejectAction(actionId: string): ActionResult {
    const item = this.getProposed(actionId);
    // Cancellation is local: no authorization or execution request is sent.
    item.result = { actionId, status: 'REJECTED' };
    return { ...item.result };
  }

  async executeApprovedAction(actionId: string, approval: boolean): Promise<ActionResult> {
    if (typeof approval !== 'boolean') throw new Error('批准必须是明确的布尔值');
    const item = this.getProposed(actionId);
    if (!approval) return this.rejectAction(actionId);
    if (this.busy) throw new Error('请等待当前操作完成');
    this.busy = true;
    item.result = { actionId, status: 'APPROVED' };
    try {
      const authorization = authorizationSchema.parse(await this.gateway.authorizeAction(actionId, true));
      if (authorization.status !== 'APPROVED' || authorization.actionId !== actionId
        || authorization.periodId !== item.periodId
        || JSON.stringify(authorization.action) !== JSON.stringify(item.action)) {
        throw new Error('授权与用户确认的建议不一致，未执行');
      }
      const journey = await this.store.getJourney();
      if (journey?.currentPeriodId !== item.periodId) throw new Error('当前阶段已改变，请重新生成建议');
      if (item.replanContext) {
        const original = item.replanContext;
        const fresh = await new AgentContextService(this.store).build({
          journeyId: original.journey.id, date: original.currentWeek.windowStart,
        });
        if (fresh.currentWeek.windowStart !== original.currentWeek.windowStart
          || fresh.currentWeek.windowEnd !== original.currentWeek.windowEnd) throw new Error('当前周次已改变，请重新生成建议');
        validateReplanActions(fresh, [item.action]);
        if (item.action.toolName === 'update_task') {
          const taskId = item.action.arguments.taskId;
          const before = original.tasks.find((task) => task.id === taskId);
          const current = fresh.tasks.find((task) => task.id === taskId);
          if (JSON.stringify(before) !== JSON.stringify(current)) throw new Error('任务在建议后已改变，请重新生成建议');
        }
      }
      const tool = this.tools.get(item.action.toolName);
      if (!tool) throw new Error('未知工具');
      const arguments_ = tool.inputSchema.parse(item.action.arguments);
      const task = await tool.execute(arguments_, item.periodId);
      item.result = { actionId, status: 'EXECUTED', task };
    } catch (error) {
      item.result = { actionId, status: 'FAILED', error: error instanceof Error ? error.message : '执行失败' };
    } finally { this.busy = false; }
    return structuredClone(item.result);
  }

  private getProposed(actionId: string): Pending {
    const item = this.pending.get(actionId);
    if (!item || item.result.status !== 'PROPOSED') throw new Error('操作不存在或已处理，请重新生成建议');
    return item;
  }
}
