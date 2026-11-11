import type { AgentActionGateway } from '@/application/agent/AgentActionService';
import { AI_CONNECTION_HELP, isNetworkFetchFailure } from './fetchFailure';
import { agentActionProposalSchema, authorizationSchema } from '@/domain/agent/actions';
import type { AgentContext } from '@/domain/agent/types';

export class AgentBackendClient implements AgentActionGateway {
  constructor(
    private readonly baseUrl = process.env.EXPO_PUBLIC_GROWAI_API_URL ?? '',
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async proposeActions(context: AgentContext, userMessage: string) {
    return agentActionProposalSchema.parse(await this.post('/propose', { context, user_message: userMessage }));
  }

  async authorizeAction(actionId: string, approval: boolean) {
    return authorizationSchema.parse(await this.post('/execute', { actionId, approval }));
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    if (!this.baseUrl) throw new Error('尚未配置 GrowAI Backend URL');
    let response: Response;
    try {
      response = await this.fetcher.call(globalThis, `${this.baseUrl.replace(/\/$/, '')}/api/v1/agent${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
    } catch (error) {
      if (!isNetworkFetchFailure(error)) throw error;
      throw new Error(AI_CONNECTION_HELP);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail?.message ?? `Agent 请求失败（${response.status}）`);
    return payload;
  }
}
