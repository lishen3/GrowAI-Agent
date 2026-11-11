from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from uuid import uuid4

from app.models.planning_preview import PlanningPreviewRequest, PlanningPreviewResult
from app.models.lite_generator import LiteGeneratorDraft
from app.models.demo_approval import DemoExecutionValidation
from app.models.replan_approval import AllowedDatesEvidence, ApprovalScope, PolicyValidation
from app.services.approval_store import InMemoryApprovalStore
from app.services.replan_approval_service import ApprovalService, FreshValidationResult, source_facts_digest
from app.services.date_only_candidates import build_date_only_candidates
from app.services.date_only_policy import validate_date_only_actions


@dataclass(frozen=True)
class PlanningReceipt:
    payload: PlanningPreviewRequest
    result: PlanningPreviewResult
    expires_at: datetime


def scope_for(payload):
    if payload.session_id is None or payload.reset_epoch is None:
        raise ValueError('DEMO_SESSION_REQUIRED')
    return ApprovalScope(journeyId=payload.context.journey.id, periodId=payload.context.currentPeriod.id,
        weekStart=payload.context.currentWeek.windowStart, weekEnd=payload.context.currentWeek.windowEnd,
        dataSpace='DEMO', sessionId=payload.session_id, resetEpoch=payload.reset_epoch)


class SnapshotFreshValidation:
    """Actual policy rerun on submitted local Demo facts, not a backend DB attestation."""
    def __init__(self, receipt, facts, clock):
        self.receipt = receipt
        self.facts = PlanningPreviewRequest.model_validate(facts.model_dump())
        self.clock = clock

    def check(self, draft):
        source = self.receipt.payload
        current = self.facts
        now = self.clock()
        day = now.astimezone(timezone(timedelta(hours=8))).date().isoformat()
        if (now >= self.receipt.expires_at or current.runtime_date != day
                or scope_for(current) != scope_for(source)
                or source_facts_digest(current.context) != source_facts_digest(source.context)
                or current.task_facts != source.task_facts
                or current.allowed_dates != source.allowed_dates):
            raise ValueError('DEMO_FACTS_OR_SESSION_CHANGED')
        constraints = {task.id: {'periodId': task.periodId, 'deadline': task.deadline} for task in current.task_facts}
        candidates = build_date_only_candidates(current.context, self.receipt.result.planner,
            runtime_date=day, task_constraints=constraints, allowed_dates=set(source.allowed_dates))
        validate_date_only_actions(current.context, draft, candidate_task_ids=candidates.candidate_task_ids,
            runtime_date=day, task_constraints=constraints, allowed_dates=set(source.allowed_dates))
        for action in draft.actions:
            if action.arguments.changes.plannedDate not in candidates.allowed_target_dates[action.arguments.taskId]:
                raise ValueError('TARGET_NO_LONGER_ALLOWED')
        return PolicyValidation(version='DATE_ONLY_MVP_V1', evaluatedAt=self.clock(), checks=[
            {'name': 'DATE_ONLY', 'result': 'PASS'}, {'name': 'GENERAL_REPLAN', 'result': 'PASS'}])

    async def validate(self, request):
        draft = LiteGeneratorDraft.model_validate({'actions': [{'toolName': change.toolName,
            'arguments': {'taskId': change.taskId, 'changes': change.after.model_dump()}, 'reason': change.reason}
            for change in request.proposedChanges]})
        policy = self.check(draft)
        task = next(task for task in self.facts.task_facts if task.id == request.proposedChanges[0].taskId)
        return FreshValidationResult(valid=True, scope=scope_for(self.facts), taskFacts=task,
            sourceContextDigest=source_facts_digest(self.facts.context),
            allowedDatesEvidence=request.allowedDatesEvidence, policyValidation=policy)


class DemoApprovalFlow:
    """App-owned receipt adapter to the existing ApprovalService. No Task IO or execution."""
    def __init__(self, *, clock=lambda: datetime.now(timezone.utc)):
        self.clock = clock
        self.store = InMemoryApprovalStore()
        self.service = ApprovalService(self.store, fresh_validation=None, clock=clock)
        self.receipts = {}
        self.requests = {}
        self.approved_change_sets = {}
        self.execution_claims = set()
        self.lock = Lock()

    def ensure_capacity(self):
        # Bounded process-local demo history. Restart is deliberate, not automatic authorization recovery.
        if len(self.receipts) >= 100:
            raise ValueError('DEMO_RECEIPT_CAPACITY_REACHED')

    def retain(self, payload, result):
        with self.lock:
            self.ensure_capacity()
            scope_for(payload)
            receipt_id = uuid4().hex
            result = result.model_copy(deep=True, update={'previewId': receipt_id})
            self.receipts[receipt_id] = PlanningReceipt(payload.model_copy(deep=True), result.model_copy(deep=True),
                                                       self.clock() + timedelta(seconds=900))
            return result

    def create(self, receipt_id, action_index, facts):
        with self.lock:
            receipt = self.receipts.get(receipt_id)
            if receipt is None:
                raise ValueError('PLANNING_RECEIPT_NOT_FOUND')
            if not 0 <= action_index < len(receipt.result.draft.actions):
                raise ValueError('NO_SELECTED_ACTION')
            draft = LiteGeneratorDraft(actions=[receipt.result.draft.actions[action_index]])
            policy = SnapshotFreshValidation(receipt, facts, self.clock).check(draft)
            key = (receipt_id, action_index)
            if key in self.requests:
                existing = self.service.getApproval(self.requests[key])
                if existing.status != 'PENDING' or self.clock() >= existing.expiresAt:
                    raise ValueError('APPROVAL_ALREADY_DECIDED_OR_EXPIRED')
                return existing
            request = self.service.createApproval(draft, context_snapshot=facts.context,
                scope=scope_for(facts), task_facts={task.id: task.model_dump() for task in facts.task_facts},
                allowed_dates_evidence=AllowedDatesEvidence(dates=tuple(receipt.payload.allowed_dates),
                    sourceType='USER', confirmationReference=receipt_id),
                policy_result=policy, source_draft_id=receipt_id)
            self.requests[key] = request.id
            return request

    async def approve(self, approval_id, decision, content, facts):
        request = self.service.getApproval(approval_id)
        receipt = self.receipts.get(request.sourceDraftId) if request else None
        provider = SnapshotFreshValidation(receipt, facts, self.clock) if receipt else None
        # Same authoritative Store; no second approval state machine or permissive mock.
        service = ApprovalService(self.store, fresh_validation=provider, clock=self.clock)
        result = await service.approve(approval_id, decision, content)
        if result.status == 'APPROVED' and result.changeSet is not None:
            self.approved_change_sets[approval_id] = result.changeSet.model_copy(deep=True)
        return result

    def execution_approval(self, approval_id):
        request = self.service.getApproval(approval_id)
        change_set = self.approved_change_sets.get(approval_id)
        if request is None or request.status != 'APPROVED' or change_set is None:
            raise ValueError('APPROVED_AUTHORITY_NOT_FOUND')
        return {'status': request.status, 'changeSet': change_set.model_copy(deep=True)}

    def prepare_execution(self, approval_id, change_set, facts):
        # Claim authorizes one local attempt, not a claim that a DB write happened.
        with self.lock:
            authority = self.execution_approval(approval_id)['changeSet']
            if change_set != authority or approval_id in self.execution_claims:
                raise ValueError('CHANGE_SET_MISMATCH_OR_ALREADY_CLAIMED')
            request = self.service.getApproval(approval_id)
            now = self.clock()
            if not authority.approvedAt <= now < authority.executeBefore:
                raise ValueError('EXECUTION_TTL_INVALID')
            receipt = self.receipts.get(request.sourceDraftId)
            if receipt is None:
                raise ValueError('PLANNING_RECEIPT_NOT_FOUND')
            draft = LiteGeneratorDraft.model_validate({'actions': [
                {'toolName': c.toolName, 'arguments': {'taskId': c.taskId, 'changes': c.after.model_dump()},
                 'reason': c.reason} for c in authority.changes]})
            SnapshotFreshValidation(receipt, facts, self.clock).check(draft)
            self.execution_claims.add(approval_id)
            return DemoExecutionValidation(scope=scope_for(facts), valid=True,
                periodStart=facts.context.currentPeriod.startDate, periodEnd=facts.context.currentPeriod.endDate)
