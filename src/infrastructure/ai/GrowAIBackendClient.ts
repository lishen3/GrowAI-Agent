import type { WeeklyAnalysisGateway, WeeklyAnalysisRequest } from '@/application/analysis/WeeklyAnalysisService';
import { AI_CONNECTION_HELP, isNetworkFetchFailure } from './fetchFailure';
import { weeklyAnalysisResultSchema, type WeeklyAnalysisResult } from '@/domain/analysis/types';

export class BackendAnalysisError extends Error {
  constructor(message: string, readonly code: string = 'BACKEND_ERROR') {
    super(message);
    this.name = 'BackendAnalysisError';
  }
}

type Fetcher = typeof fetch;

export class GrowAIBackendClient implements WeeklyAnalysisGateway {
  constructor(
    private readonly baseUrl = process.env.EXPO_PUBLIC_GROWAI_API_URL ?? '',
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async analyzeWeekly(request: WeeklyAnalysisRequest): Promise<WeeklyAnalysisResult> {
    if (!this.baseUrl) {
      throw new BackendAnalysisError('尚未配置 GrowAI Backend URL', 'BACKEND_NOT_CONFIGURED');
    }
    let response: Response;
    try {
      response = await this.fetcher.call(globalThis, `${this.baseUrl.replace(/\/$/, '')}/api/v1/analysis/weekly`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: request.context,
          user_message: request.userMessage ?? null,
        }),
      });
    } catch (error) {
      if (!isNetworkFetchFailure(error)) throw error;
      throw new BackendAnalysisError(AI_CONNECTION_HELP, 'BACKEND_UNREACHABLE');
    }

    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const detail = typeof payload === 'object' && payload !== null && 'detail' in payload
        ? (payload as { detail?: { code?: string; message?: string } }).detail
        : undefined;
      throw new BackendAnalysisError(
        detail?.message ?? 'AI 分析失败，请稍后重试',
        detail?.code ?? `HTTP_${response.status}`,
      );
    }
    const parsed = weeklyAnalysisResultSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BackendAnalysisError('AI 返回的数据格式无效', 'INVALID_ANALYSIS_RESPONSE');
    }
    return parsed.data;
  }
}
