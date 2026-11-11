import { DemoPlanningService } from './DemoPlanningService';
import { DemoApprovalBackendClient } from '@/infrastructure/ai/DemoApprovalBackendClient';
import type { DemoApprovalRequest } from '@/domain/replan/approval';
import { PlanningPreviewError, type DemoPlanningSnapshot, type PlanningPreview } from '@/domain/replan/planningPreview';
import { sameContent } from '@/domain/replan/execution';

export class DemoApprovalService {
  constructor(private readonly planning: DemoPlanningService, private readonly client: DemoApprovalBackendClient) {}

  async submit(active: boolean, preview: PlanningPreview, original: DemoPlanningSnapshot, index: number, allowedDate: string) {
    if (!preview.previewId || !preview.draft.actions[index]) throw new Error('没有可提交的 Planning 收据或动作');
    const fresh = await this.planning.load(active);
    if (!sameContent(fresh.session, original.session) || !sameContent(fresh.tasks, original.tasks)) throw new Error('Demo 会话或任务已变化，请重新生成');
    const request = await this.client.submit(preview.previewId, index, fresh, allowedDate);
    const action = preview.draft.actions[index];
    const before = original.tasks.find((task) => task.id === action.arguments.taskId)!;
    const change = request.proposedChanges[0];
    if (request.status !== 'PENDING' || request.sourceDraftId !== preview.previewId || request.scope.dataSpace !== 'DEMO'
      || request.scope.sessionId !== fresh.session?.sessionId || request.scope.resetEpoch !== fresh.session?.resetEpoch
      || request.scope.periodId !== fresh.context.currentPeriod.id || request.scope.journeyId !== fresh.context.journey.id
      || !sameContent(request.preconditions.expectedTaskFacts, before)
      || change.taskId !== before.id || change.before.plannedDate !== before.plannedDate
      || !sameContent(change.after, action.arguments.changes) || change.reason !== action.reason) {
      throw new Error('申请与用户所见建议不一致，未批准');
    }
    return request;
  }

  async approve(active: boolean, request: DemoApprovalRequest) {
    const fresh = await this.planning.load(active);
    const result = await this.client.approve(request, fresh);
    const changeSet = result.changeSet;
    if (result.status !== 'APPROVED' || !changeSet) {
      throw new PlanningPreviewError(`授权未通过：${result.error ?? result.status}，任务未执行`, true, result.status, 'APPROVAL');
    }
    if (result.request?.status !== 'APPROVED' || result.request.id !== request.id
      || changeSet.approvalRequestId !== request.id || changeSet.authorizationReference !== request.id
      || changeSet.approvalContentDigest !== request.selectedContentDigest
      || !sameContent(changeSet.scope, request.scope) || !sameContent(changeSet.changes, request.proposedChanges)
      || !sameContent(changeSet.expectedTaskFacts, request.preconditions.expectedTaskFacts)) {
      throw new Error('ApprovedChangeSet 与确认内容不一致，未执行');
    }
    return changeSet;
  }
}
