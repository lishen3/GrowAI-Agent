import hashlib
from copy import deepcopy
from datetime import datetime, time, timedelta, timezone
from typing import Callable, Protocol
from uuid import uuid4
from pydantic import StrictBool

from app.models.context import AgentContext
from app.models.lite_generator import LiteGeneratorDraft
from app.models.replan_approval import (
    AllowedDatesEvidence, ApprovalDecisionResult, ApprovalRequest, ApprovalScope,
    ContractModel, PolicyValidation, TaskSnapshot,
)
from app.services.approval_store import ApprovalStore
from app.services.replan_approval_contract import (
    content_digest, create_approval_requests, validateApprovalDecision,
)


def source_facts_digest(context: AgentContext) -> str:
    # Rebuilt context timestamps are not changes to underlying source facts.
    return hashlib.sha256(context.model_dump_json(exclude={'generatedAt'}).encode()).hexdigest()


class FreshValidationResult(ContractModel):
    valid: StrictBool
    scope: ApprovalScope
    taskFacts: TaskSnapshot
    sourceContextDigest: str
    allowedDatesEvidence: AllowedDatesEvidence
    policyValidation: PolicyValidation


class FreshValidationProvider(Protocol):
    async def validate(self, request: ApprovalRequest) -> FreshValidationResult: ...


class ApprovalService:
    """Lifecycle only. No API, real fresh-facts adapter, Tool or Task database."""

    def __init__(self, store: ApprovalStore, *, fresh_validation: FreshValidationProvider | None,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)):
        self.store = store
        self.fresh_validation = fresh_validation
        self.clock = clock

    def createApproval(self, draft: LiteGeneratorDraft, *, context_snapshot: AgentContext,
                       scope: ApprovalScope, task_facts: dict[str, dict],
                       allowed_dates_evidence: AllowedDatesEvidence, policy_result: PolicyValidation,
                       source_draft_id: str, trace_id: str | None = None) -> ApprovalRequest:
        draft = LiteGeneratorDraft.model_validate(draft.model_dump())
        if len(draft.actions) != 1:
            raise ValueError('Create one independent approval per action; empty changes are not approvable')
        context = AgentContext.model_validate(context_snapshot.model_dump())
        if (scope.journeyId != context.journey.id or scope.periodId != context.currentPeriod.id
                or scope.weekStart != context.currentWeek.windowStart or scope.weekEnd != context.currentWeek.windowEnd
                or context.currentPeriod.status != 'ACTIVE'):
            raise ValueError('Approval scope must match the active source context')
        now = self.clock()
        if now.tzinfo is None:
            raise ValueError('Approval clock must include a timezone')
        local = now.astimezone(timezone(timedelta(hours=8)))
        day = local.date().isoformat()
        if not max(scope.weekStart, context.currentPeriod.startDate) <= day <= min(scope.weekEnd, context.currentPeriod.endDate):
            raise ValueError('Source period or week is no longer current')
        task_id = draft.actions[0].arguments.taskId
        source_task = next((task for task in context.tasks if task.id == task_id), None)
        task = TaskSnapshot.model_validate(task_facts[task_id])
        if source_task is None or any(task.model_dump()[key] != value for key, value in source_task.model_dump().items()):
            raise ValueError('Full task facts do not match source context')
        if draft.actions[0].arguments.changes.plannedDate < day:
            raise ValueError('Target date is in the past')
        midnight = datetime.combine(local.date() + timedelta(days=1), time.min, tzinfo=local.tzinfo)
        request = create_approval_requests(draft, request_ids=(uuid4().hex,), source_draft_id=source_draft_id,
            scope=scope, task_facts={task_id: task.model_dump()}, allowed_dates_evidence=allowed_dates_evidence,
            policy_checks=tuple(check.model_dump() for check in policy_result.checks),
            policy_version=policy_result.version, source_context_digest=source_facts_digest(context),
            created_at=now, expires_at=min(now + timedelta(seconds=900), midnight),
            evaluated_at=policy_result.evaluatedAt)[0]
        request = ApprovalRequest.model_validate({**request.model_dump(), 'traceId': trace_id})
        request = request.model_copy(update={'selectedContentDigest': content_digest(request)})
        self.store.save(request)
        return request.model_copy(deep=True)

    def getApproval(self, approval_id: str) -> ApprovalRequest | None:
        return self.store.get(approval_id)

    def _invalid(self, request: ApprovalRequest | None, reason: str, *, expired=False) -> ApprovalDecisionResult:
        status = 'EXPIRED' if expired else 'INVALID'
        if request is None:
            return ApprovalDecisionResult(status='INVALID', request=None, error=reason)
        if request.status != 'PENDING':
            return ApprovalDecisionResult(status='INVALID', request=request, error=reason)
        updated = request.model_copy(deep=True, update={'status': status, 'decidedAt': self.clock(), 'invalidReason': reason})
        if not self.store.update(updated, expected_digest=request.selectedContentDigest):
            return ApprovalDecisionResult(status='INVALID', request=self.store.get(request.id), error='CONCURRENT_DECISION')
        return ApprovalDecisionResult(status=status, request=updated, error=reason)

    async def approve(self, approval_id: str, userDecision: bool, confirmedContent: dict) -> ApprovalDecisionResult:
        confirmedContent = deepcopy(confirmedContent)
        request = self.store.get(approval_id)
        if request is None or request.status != 'PENDING':
            return self._invalid(request, 'REQUEST_NOT_FOUND_OR_ALREADY_DECIDED')
        if userDecision is not True:
            return self._invalid(request, 'EXPLICIT_APPROVAL_REQUIRED')
        now = self.clock()
        # Local checks before potentially asynchronous fresh validation.
        try:
            result = validateApprovalDecision(request, approval=True,
                selected_content_digest=confirmedContent['selectedContentDigest'],
                scope=ApprovalScope.model_validate(confirmedContent['scope']),
                confirmed_changes=confirmedContent['changes'], now=now)
            if set(confirmedContent) != {'selectedContentDigest', 'scope', 'changes'}:
                return self._invalid(request, 'UNEXPECTED_CONFIRMATION_FIELDS')
        except (ValueError, KeyError, TypeError):
            return self._invalid(request, 'INVALID_CONFIRMED_CONTENT')
        if result.status != 'APPROVED':
            return self._invalid(request, result.error or 'CONTRACT_REJECTED', expired=result.status == 'EXPIRED')
        if self.fresh_validation is None:
            return self._invalid(request, 'FRESH_VALIDATION_UNAVAILABLE')
        try:
            fresh = await self.fresh_validation.validate(request.model_copy(deep=True))
            fresh = FreshValidationResult.model_validate(fresh.model_dump())
            now = self.clock()
            if (not fresh.valid or fresh.scope != request.scope
                    or fresh.taskFacts != request.preconditions.expectedTaskFacts
                    or fresh.sourceContextDigest != request.preconditions.sourceContextDigest
                    or fresh.allowedDatesEvidence != request.allowedDatesEvidence
                    or fresh.policyValidation.version != request.policyVersion
                    or not request.createdAt <= fresh.policyValidation.evaluatedAt <= now
                    or len(fresh.policyValidation.checks) != 2
                    or {c.name for c in fresh.policyValidation.checks} != {'DATE_ONLY', 'GENERAL_REPLAN'}
                    or any(c.result != 'PASS' for c in fresh.policyValidation.checks)):
                return self._invalid(request, 'FRESH_VALIDATION_FAILED')
        except Exception:
            return self._invalid(request, 'FRESH_VALIDATION_FAILED')
        # Recheck TTL/day after the await, and never expose the provisional ChangeSet.
        result = validateApprovalDecision(request, approval=True,
            selected_content_digest=confirmedContent['selectedContentDigest'],
            scope=fresh.scope, confirmed_changes=confirmedContent['changes'], now=now)
        if result.status != 'APPROVED':
            return self._invalid(request, result.error or 'CONTRACT_REJECTED', expired=result.status == 'EXPIRED')
        if not self.store.update(result.request, expected_digest=request.selectedContentDigest):
            return ApprovalDecisionResult(status='INVALID', request=self.store.get(approval_id), error='CONCURRENT_DECISION')
        change_set = result.changeSet.model_copy(deep=True, update={'policyValidation': fresh.policyValidation})
        return result.model_copy(update={'changeSet': change_set})

    def reject(self, approval_id: str) -> ApprovalDecisionResult:
        request = self.store.get(approval_id)
        if request is None:
            return self._invalid(None, 'REQUEST_NOT_FOUND')
        result = validateApprovalDecision(request, approval=False,
            selected_content_digest=request.selectedContentDigest, scope=request.scope,
            confirmed_changes=[c.model_dump() for c in request.proposedChanges], now=self.clock())
        if request.status == 'PENDING' and result.request is not None:
            if not self.store.update(result.request, expected_digest=request.selectedContentDigest):
                return ApprovalDecisionResult(status='INVALID', request=self.store.get(approval_id), error='CONCURRENT_DECISION')
        return result

    def expire(self, approval_id: str) -> ApprovalDecisionResult:
        request = self.store.get(approval_id)
        if request is None or request.status != 'PENDING':
            return self._invalid(request, 'REQUEST_NOT_FOUND_OR_ALREADY_DECIDED')
        if self.clock() < request.expiresAt:
            return ApprovalDecisionResult(status='INVALID', request=request, error='NOT_YET_EXPIRED')
        return self._invalid(request, 'REQUEST_EXPIRED', expired=True)
