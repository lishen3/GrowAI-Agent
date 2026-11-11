import { TaskApplicationService } from '@/application/tasks/TaskApplicationService';
import { assertDateOnlyBefore, DateOnlyRejectedError, isoDateSchema, sameTask, taskSnapshotSchema } from '@/domain/tasks/dateOnly';
import { approvedChangeSetSchema, executionScopeSchema, sameContent,
  type ApprovedChangeSet, type ExecutionResult, type ExecutionScope } from '@/domain/replan/execution';
import { createId } from '@/shared/id';

export interface ExecutionApprovalGateway {
  // Trusted integration, never a user-provided authorization object.
  getApproval(id: string): Promise<{ status: string; changeSet: ApprovedChangeSet } | null>;
  validateFresh(changeSet: ApprovedChangeSet): Promise<{
    scope: ExecutionScope; periodStart: string; periodEnd: string; valid: boolean;
  }>;
}

export class ReplanExecutionService {
  private readonly attempted = new Set<string>();

  constructor(private readonly tasks: TaskApplicationService, private readonly approvals: ExecutionApprovalGateway,
    private readonly clock: () => Date = () => new Date()) {}

  async execute(input: unknown): Promise<ExecutionResult> {
    const result: ExecutionResult = { executionId: createId('replan_execution'), changeSetId: null, taskId: null,
      status: 'REJECTED', before: null, after: null, reason: 'INVALID_CHANGE_SET', writeOutcome: 'NOT_ATTEMPTED' };
    const parsed = approvedChangeSetSchema.safeParse(input);
    if (!parsed.success) return result;
    const changeSet = parsed.data;
    const change = changeSet.changes[0];
    result.changeSetId = changeSet.id;
    result.taskId = change.taskId;
    if (this.attempted.has(changeSet.approvalRequestId)) return { ...result, reason: 'ALREADY_ATTEMPTED' };
    // Claim before the first await. Failures remain consumed in this service instance.
    this.attempted.add(changeSet.approvalRequestId);
    try {
      const approval = await this.approvals.getApproval(changeSet.approvalRequestId);
      if (!approval || approval.status !== 'APPROVED'
        || !sameContent(approvedChangeSetSchema.parse(approval.changeSet), changeSet)
        || changeSet.authorizationReference !== changeSet.approvalRequestId) {
        return { ...result, reason: 'APPROVAL_INVALID' };
      }
      const fresh = await this.approvals.validateFresh(structuredClone(changeSet));
      isoDateSchema.parse(fresh.periodStart);
      isoDateSchema.parse(fresh.periodEnd);
      if (fresh.valid !== true || !sameContent(executionScopeSchema.parse(fresh.scope), changeSet.scope)) {
        return { ...result, reason: 'FRESH_VALIDATION_FAILED' };
      }
      const now = this.clock();
      const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
      const approvedDay = new Date(Date.parse(changeSet.approvedAt) + 8 * 3600000).toISOString().slice(0, 10);
      const target = change.after.plannedDate;
      if (now.getTime() < Date.parse(changeSet.approvedAt) || now.getTime() >= Date.parse(changeSet.executeBefore)
        || day !== approvedDay || day < changeSet.scope.weekStart || day > changeSet.scope.weekEnd
        || target < day || target < changeSet.scope.weekStart || target > changeSet.scope.weekEnd
        || day < fresh.periodStart || day > fresh.periodEnd || target < fresh.periodStart || target > fresh.periodEnd) {
        return { ...result, reason: 'DATE_OR_TTL_INVALID' };
      }
      const expected = changeSet.expectedTaskFacts;
      if (expected.id !== change.taskId || expected.periodId !== changeSet.scope.periodId
        || expected.plannedDate !== change.before.plannedDate || target === change.before.plannedDate) {
        return { ...result, reason: 'CHANGE_BINDING_INVALID' };
      }
      const before = await this.tasks.getTask(change.taskId);
      assertDateOnlyBefore(before, { taskId: change.taskId, targetDate: target, expectedBefore: expected });
      result.before = structuredClone(before);
      if (this.clock().getTime() >= Date.parse(changeSet.executeBefore)) {
        return { ...result, reason: 'DATE_OR_TTL_INVALID' };
      }
      // Task Application and Repository recheck the full expected snapshot; do not use generic updateTask.
      result.writeOutcome = 'UNKNOWN';
      await this.tasks.updateTaskDateOnly({ taskId: change.taskId, targetDate: target, expectedBefore: expected });
      result.writeOutcome = 'COMMITTED';
      const readback = await this.tasks.getTask(change.taskId);
      if (!readback) return { ...result, status: 'FAILED', reason: 'READBACK_TASK_MISSING' };
      const after = taskSnapshotSchema.parse(readback);
      result.after = structuredClone(after);
      if (!sameTask(after, { ...before, plannedDate: target })) {
        return { ...result, status: 'FAILED', reason: 'READBACK_MISMATCH' };
      }
      return { ...result, status: 'SUCCESS', reason: 'DATE_ONLY_READBACK_VERIFIED' };
    } catch (error) {
      if (error instanceof DateOnlyRejectedError) {
        return { ...result, status: 'REJECTED', reason: error.message, writeOutcome: 'NOT_ATTEMPTED' };
      }
      return { ...result, status: result.writeOutcome === 'NOT_ATTEMPTED' ? 'REJECTED' : 'FAILED',
        reason: result.writeOutcome === 'COMMITTED' ? 'READBACK_FAILED' : 'VALIDATION_OR_REPOSITORY_FAILED' };
    }
  }
}
