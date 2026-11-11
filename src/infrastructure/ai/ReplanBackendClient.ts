import type { ReplanGateway } from '@/application/replan/WeeklyReplanService';
import { AI_CONNECTION_HELP, isNetworkFetchFailure } from './fetchFailure';
import type { AgentContext } from '@/domain/agent/types';
import { weeklyReplanProposalSchema } from '@/domain/replan/types';

export class ReplanBackendClient implements ReplanGateway {
  constructor(private readonly baseUrl = process.env.EXPO_PUBLIC_GROWAI_API_URL ?? '',
    private readonly fetcher: typeof fetch = fetch) {}

  async replanWeekly(context: AgentContext, userMessage: string) {
    if (!this.baseUrl) throw new Error('尚未配置 GrowAI Backend URL');
    let response: Response;
    try {
      response = await this.fetcher.call(globalThis, `${this.baseUrl.replace(/\/$/, '')}/api/v1/replan/weekly`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, user_message: userMessage }),
      });
    } catch (error) {
      if (!isNetworkFetchFailure(error)) throw error;
      throw new Error(AI_CONNECTION_HELP);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail?.message ?? `重排请求失败（${response.status}）`);
    return weeklyReplanProposalSchema.parse(payload);
  }
}
