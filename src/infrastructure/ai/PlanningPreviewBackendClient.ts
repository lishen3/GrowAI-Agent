import { isNetworkFetchFailure } from './fetchFailure';
import { planningPreviewSchema, PlanningPreviewError, type DemoPlanningSnapshot } from '@/domain/replan/planningPreview';

export class PlanningPreviewBackendClient {
  constructor(private readonly baseUrl = process.env.EXPO_PUBLIC_GROWAI_API_URL ?? '',
    private readonly fetcher: typeof fetch = fetch) {}

  async preview(snapshot: DemoPlanningSnapshot, userMessage: string, allowedDate: string) {
    if (!this.baseUrl) throw new PlanningPreviewError('尚未配置 GrowAI Backend URL', false, 'BACKEND_NOT_CONFIGURED', 'REQUEST');
    let response: Response;
    try {
      response = await this.fetcher.call(globalThis, `${this.baseUrl.replace(/\/$/, '')}/api/v1/replan/date-only/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          context: snapshot.context, user_message: userMessage, runtime_date: snapshot.runtimeDate,
          task_facts: snapshot.tasks, allowed_dates: [allowedDate],
          session_id: snapshot.session?.sessionId, reset_epoch: snapshot.session?.resetEpoch,
        }),
      });
    } catch (error) {
      if (!isNetworkFetchFailure(error)) throw error;
      throw new PlanningPreviewError('无法连接 Planning 服务，未修改任务', false, 'NETWORK_ERROR', 'REQUEST');
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload?.detail;
      throw new PlanningPreviewError(typeof detail?.message === 'string' ? detail.message : `预览请求失败（HTTP ${response.status}）`,
        response.status === 409 || (response.status === 422 && detail?.code !== 'INVALID_DRAFT'),
        typeof detail?.code === 'string' ? detail.code : `HTTP_${response.status}`,
        typeof detail?.stage === 'string' ? detail.stage : 'REQUEST');
    }
    return planningPreviewSchema.parse(payload);
  }
}
