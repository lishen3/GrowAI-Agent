import type { ReflectionGateway } from '@/application/reflection/WeeklyReflectionService';
import { AI_CONNECTION_HELP, isNetworkFetchFailure } from './fetchFailure';
import type { AgentContext } from '@/domain/agent/types';
import { weeklyReflectionDraftSchema, type WeeklyReflectionDraft } from '@/domain/reflection/types';
import { BackendAnalysisError } from './GrowAIBackendClient';
import { validateGrowthReflection } from '@/domain/reflection/evidence';

export class ReflectionBackendClient implements ReflectionGateway {
  constructor(private readonly baseUrl = process.env.EXPO_PUBLIC_GROWAI_API_URL ?? '',
    private readonly fetcher: typeof fetch = fetch) {}

  async reflectWeekly(context: AgentContext, userMessage?: string) {
    return this.withDeadline(signal => this.request(context, userMessage, signal));
  }

  startReflection(context: AgentContext, requestId: string) {
    return this.withDeadline(signal => this.job(context, requestId, false, signal));
  }

  resumeReflection(context: AgentContext, requestId: string) {
    return this.withDeadline(signal => this.job(context, requestId, true, signal));
  }

  recoverReflection(context: AgentContext, requestId: string) {
    return this.withDeadline(signal => this.job(context, requestId, true, signal, true));
  }

  private async withDeadline<T>(work: (signal: AbortSignal) => Promise<T>) {
    if (!this.baseUrl) throw new BackendAnalysisError('尚未配置 GrowAI Backend URL', 'BACKEND_NOT_CONFIGURED');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new BackendAnalysisError('复盘等待超时，结果尚未确认；请先查看历史，避免重复生成。', 'REFLECTION_WAIT_TIMEOUT'));
        controller.abort();
      }, 135_000);
    });
    try {
      return await Promise.race([work(controller.signal), expired]);
    } finally { clearTimeout(timer); }
  }

  private job(context: AgentContext, requestId: string, resume: boolean, signal: AbortSignal, snapshot: true): Promise<{ context: AgentContext; draft: WeeklyReflectionDraft }>;
  private job(context: AgentContext, requestId: string, resume: boolean, signal: AbortSignal, snapshot?: false): Promise<WeeklyReflectionDraft>;
  private async job(context: AgentContext, requestId: string, resume: boolean, signal: AbortSignal, snapshot = false): Promise<WeeklyReflectionDraft | { context: AgentContext; draft: WeeklyReflectionDraft }> {
    let path = resume ? '/weekly/jobs/status' : '/weekly/jobs';
    let body: object = resume ? { request_id: requestId, ...(snapshot ? {} : { context }) } : { request_id: requestId, context, user_message: null };
    while (!signal.aborted) {
      let response: Response;
      try {
        response = await this.fetcher.call(globalThis, `${this.baseUrl.replace(/\/$/, '')}/api/v1/reflection${path}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify(body),
        });
      } catch (error) {
        if (isNetworkFetchFailure(error)) throw new BackendAnalysisError(AI_CONNECTION_HELP, 'BACKEND_UNREACHABLE');
        throw error;
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 422 && Array.isArray(payload?.detail)) {
          const invalidHandle = payload.detail.some((issue: { loc?: unknown[]; type?: string } | null) =>
            issue?.type === 'string_pattern_mismatch' && issue.loc?.length === 2 && issue.loc[0] === 'body' && issue.loc[1] === 'request_id');
          if (invalidHandle || path === '/weekly/jobs') {
            throw Object.assign(new BackendAnalysisError('请求资料未通过校验', invalidHandle ? 'REFLECTION_INVALID_HANDLE' : 'REFLECTION_INVALID_INPUT'),
              { reflectionRecovery: path === '/weekly/jobs' ? 'not_started' : 'unavailable' });
          }
        }
        const error = new BackendAnalysisError(payload?.detail?.message ?? '请求状态读取失败', payload?.detail?.code ?? `HTTP_${response.status}`);
        throw Object.assign(error, { reflectionRecovery: path === '/weekly/jobs' && ['REFLECTION_CACHE_UNAVAILABLE', 'REFLECTION_BUSY'].includes(error.code) ? 'not_started'
          : error.code === 'REFLECTION_REQUEST_UNKNOWN' ? 'unavailable' : 'unknown' });
      }
      if (payload?.scope?.journeyId !== context.journey.id || payload?.scope?.periodId !== context.currentPeriod.id
        || payload?.scope?.weekStart !== context.currentWeek.windowStart || payload?.scope?.weekEnd !== context.currentWeek.windowEnd) {
        throw new BackendAnalysisError('原请求不属于当前旅程、阶段或周，未保存结果', 'REFLECTION_SCOPE_CHANGED');
      }
      if (payload?.status === 'complete') {
        const draft = weeklyReflectionDraftSchema.parse(payload.draft);
        if (snapshot) {
          const original = payload.context as AgentContext | undefined;
          if (!original || original.journey?.id !== context.journey.id || original.currentPeriod?.id !== context.currentPeriod.id
            || original.currentWeek?.windowStart !== context.currentWeek.windowStart || original.currentWeek?.windowEnd !== context.currentWeek.windowEnd) {
            throw new BackendAnalysisError('原请求快照缺失或作用域不匹配，未保存结果', 'REFLECTION_SCOPE_CHANGED');
          }
          validateGrowthReflection(original, draft);
          return { context: original, draft };
        }
        validateGrowthReflection(context, draft);
        return draft;
      }
      if (payload?.status === 'failed') throw Object.assign(new BackendAnalysisError(payload.error?.message ?? '原复盘请求失败', payload.error?.code ?? 'REFLECTION_FAILED'), { reflectionRecovery: 'failed' });
      if (payload?.status !== 'pending') throw new BackendAnalysisError('复盘请求状态无效', 'INVALID_REFLECTION_RESPONSE');
      await new Promise(resolve => setTimeout(resolve, 1000));
      // Polling is read-only. Never repeat the generation endpoint after a failure.
      path = '/weekly/jobs/status'; body = resume ? { request_id: requestId, ...(snapshot ? {} : { context }) } : { request_id: requestId };
    }
    throw new BackendAnalysisError('复盘等待结束，结果尚未确认', 'REFLECTION_WAIT_TIMEOUT');
  }

  private async request(context: AgentContext, userMessage: string | undefined, signal: AbortSignal) {
    let response: Response;
    try {
      response = await this.fetcher.call(globalThis, `${this.baseUrl.replace(/\/$/, '')}/api/v1/reflection/weekly`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ context, user_message: userMessage ?? null }),
      });
    } catch (error) {
      if (!isNetworkFetchFailure(error)) throw error;
      throw new BackendAnalysisError(AI_CONNECTION_HELP, 'BACKEND_UNREACHABLE');
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new BackendAnalysisError(payload?.detail?.message ?? '本周复盘失败', payload?.detail?.code ?? `HTTP_${response.status}`);
    const result = weeklyReflectionDraftSchema.safeParse(payload);
    if (!result.success) throw new BackendAnalysisError('AI 复盘格式无效', 'INVALID_REFLECTION_RESPONSE');
    validateGrowthReflection(context, result.data);
    return result.data;
  }
}
