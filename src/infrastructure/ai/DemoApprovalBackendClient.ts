import { approvalRequestSchema, approvalDecisionSchema, type DemoApprovalRequest } from '@/domain/replan/approval';
import { PlanningPreviewError, type DemoPlanningSnapshot } from '@/domain/replan/planningPreview';
import { isNetworkFetchFailure } from './fetchFailure';
import { z } from 'zod';
import { approvedChangeSetSchema, executionScopeSchema, type ApprovedChangeSet } from '@/domain/replan/execution';
import { isoDateSchema } from '@/domain/tasks/dateOnly';

export class DemoApprovalBackendClient {
  constructor(private readonly baseUrl = process.env.EXPO_PUBLIC_GROWAI_API_URL ?? '',
    private readonly fetcher: typeof fetch = fetch) {}

  private facts(snapshot: DemoPlanningSnapshot, allowedDates: string[]) {
    if (!snapshot.session) throw new PlanningPreviewError('缺少 Demo 会话，请重新进入演示环境', true, 'SESSION_REQUIRED', 'APPROVAL');
    return { context: snapshot.context, task_facts: snapshot.tasks, runtime_date: snapshot.runtimeDate,
      session_id: snapshot.session.sessionId, reset_epoch: snapshot.session.resetEpoch,
      allowed_dates: allowedDates, user_message: 'Approval fresh facts（不调用模型）' };
  }

  private async post(path: string, body?: unknown) {
    if (!this.baseUrl) throw new Error('尚未配置 GrowAI Backend URL');
    let response: Response;
    try {
      response = await this.fetcher.call(globalThis, `${this.baseUrl.replace(/\/$/, '')}/api/v1/replan/date-only/${path}`, {
        method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
    } catch (error) {
      if (!isNetworkFetchFailure(error)) throw error;
      throw new Error('Approval 服务连接失败，未执行任务');
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new PlanningPreviewError(payload?.detail?.message ?? `申请失败（HTTP ${response.status}）`,
      true, payload?.detail?.code ?? 'APPROVAL_REQUEST_FAILED', 'APPROVAL');
    return payload;
  }

  async submit(previewId: string, actionIndex: number, snapshot: DemoPlanningSnapshot, allowedDate: string) {
    return approvalRequestSchema.parse(await this.post('approvals', { preview_id: previewId, action_index: actionIndex,
      facts: this.facts(snapshot, [allowedDate]) }));
  }

  async approve(request: DemoApprovalRequest, snapshot: DemoPlanningSnapshot) {
    return approvalDecisionSchema.parse(await this.post(`approvals/${encodeURIComponent(request.id)}/approve`, {
      userDecision: true, confirmedContent: { selectedContentDigest: request.selectedContentDigest,
        scope: request.scope, changes: request.proposedChanges },
      facts: this.facts(snapshot, request.allowedDatesEvidence.dates),
    }));
  }

  async executionAuthority(id: string) {
    return z.strictObject({ status: z.literal('APPROVED'), changeSet: approvedChangeSetSchema }).parse(
      await this.post(`approvals/${encodeURIComponent(id)}/execution-authority`));
  }

  async prepareExecution(changeSet: ApprovedChangeSet, snapshot: DemoPlanningSnapshot) {
    return z.strictObject({ scope: executionScopeSchema, periodStart: isoDateSchema, periodEnd: isoDateSchema,
      valid: z.literal(true) }).parse(await this.post(`approvals/${encodeURIComponent(changeSet.approvalRequestId)}/prepare-execution`, {
        changeSet, facts: this.facts(snapshot, [changeSet.changes[0].after.plannedDate]),
      }));
  }
}
