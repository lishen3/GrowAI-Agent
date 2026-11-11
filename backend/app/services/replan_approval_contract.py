import hashlib
import json
from datetime import datetime, timedelta, timezone

from app.models.lite_generator import LiteGeneratorDraft
from app.models.replan_approval import (
    ApprovalDecisionResult, ApprovalRequest, ApprovalScope, ApprovedChangeSet,
    AllowedDatesEvidence, ProposedChange, TaskSnapshot,
)


def content_digest(request: ApprovalRequest) -> str:
    content = request.model_dump(mode='json', exclude={
        'selectedContentDigest', 'status', 'decidedAt', 'invalidReason'})
    return hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':')).encode()).hexdigest()


def create_approval_requests(draft: LiteGeneratorDraft, *, request_ids: tuple[str, ...],
                             source_draft_id: str, scope: ApprovalScope,
                             task_facts: dict[str, dict], allowed_dates_evidence: AllowedDatesEvidence,
                             policy_checks: tuple[dict, ...], policy_version: str,
                             source_context_digest: str, created_at: datetime,
                             expires_at: datetime, evaluated_at: datetime) -> tuple[ApprovalRequest, ...]:
    """Pure encapsulation of application-supplied facts and policy attestations; no store."""
    draft = LiteGeneratorDraft.model_validate(draft.model_dump())
    if len(request_ids) != len(draft.actions) or len(set(request_ids)) != len(request_ids):
        raise ValueError('One unique application ID is required per action')
    if len({action.arguments.taskId for action in draft.actions}) != len(draft.actions):
        raise ValueError('Duplicate task actions')
    requests = []
    for request_id, action in zip(request_ids, draft.actions):
        task = TaskSnapshot.model_validate(task_facts[action.arguments.taskId])
        request = ApprovalRequest.model_validate({
            'id': request_id, 'sourceType': 'REPLAN_DATE_ONLY', 'sourceDraftId': source_draft_id,
            'createdAt': created_at, 'expiresAt': expires_at, 'status': 'DRAFT',
            'scope': scope.model_dump(), 'proposedChanges': [{
                'id': request_id + ':change', 'taskId': task.id, 'toolName': action.toolName,
                'before': {'plannedDate': task.plannedDate}, 'after': action.arguments.changes.model_dump(),
                'reason': action.reason, 'policyChecks': policy_checks}],
            'selectedContentDigest': 'not-yet-digested', 'allowedDatesEvidence': allowed_dates_evidence.model_dump(),
            'preconditions': {'expectedTaskFacts': task.model_dump(), 'sourceContextDigest': source_context_digest},
            'policyVersion': policy_version, 'evaluatedAt': evaluated_at,
        })
        request = request.model_copy(update={'selectedContentDigest': content_digest(request), 'status': 'PENDING'})
        requests.append(request)
    return tuple(requests)


def validateApprovalDecision(request: ApprovalRequest | None, *, approval: bool,
                             selected_content_digest: str, scope: ApprovalScope,
                             confirmed_changes: list[dict], now: datetime) -> ApprovalDecisionResult:
    """Contract-only decision. Not fresh-policy verification or executable authorization."""
    def invalid(reason, status='INVALID'):
        updated = request
        if request is not None and request.status == 'PENDING':
            updated = request.model_copy(deep=True, update={'status': status,
                'decidedAt': now if now.tzinfo is not None else None, 'invalidReason': reason})
        if updated is not None:
            try:
                updated = ApprovalRequest.model_validate(updated.model_dump())
            except (ValueError, TypeError):
                # A corrupt request cannot be echoed as a valid typed contract.
                updated = None
        return ApprovalDecisionResult(status=status, request=updated, error=reason)

    if request is None:
        return invalid('REQUEST_NOT_FOUND')
    if request.status != 'PENDING':
        return invalid('REQUEST_ALREADY_DECIDED_OR_NOT_PENDING')
    if now.tzinfo is None or type(approval) is not bool:
        return invalid('INVALID_DECISION_INPUT')
    try:
        request = ApprovalRequest.model_validate(request.model_dump())
        scope = ApprovalScope.model_validate(scope.model_dump())
        changes = tuple(ProposedChange.model_validate(value) for value in confirmed_changes)
    except (ValueError, TypeError):
        return invalid('INVALID_CONTRACT_OR_FORBIDDEN_CAPABILITY')
    if now < request.createdAt:
        return invalid('INVALID_CLOCK')
    if now >= request.expiresAt:
        return invalid('REQUEST_EXPIRED', 'EXPIRED')
    day = now.astimezone(timezone(timedelta(hours=8))).date().isoformat()
    created_day = request.createdAt.astimezone(timezone(timedelta(hours=8))).date().isoformat()
    if day != created_day:
        return invalid('RUNTIME_DATE_CHANGED', 'EXPIRED')
    if not request.scope.weekStart <= day <= request.scope.weekEnd:
        return invalid('WINDOW_EXPIRED', 'EXPIRED')
    if scope != request.scope:
        return invalid('SCOPE_CHANGED')
    if selected_content_digest != request.selectedContentDigest or content_digest(request) != request.selectedContentDigest:
        return invalid('CONTENT_DIGEST_MISMATCH')
    if changes != request.proposedChanges:
        return invalid('CLIENT_CHANGED_PROPOSAL')
    if changes[0].after.plannedDate < day:
        return invalid('TARGET_DATE_IS_PAST')
    status = 'APPROVED' if approval else 'REJECTED'
    decided = request.model_copy(deep=True, update={'status': status, 'decidedAt': now})
    change_set = None
    if approval:
        change_set = ApprovedChangeSet.model_validate({
            'id': request.id + ':approved', 'approvalRequestId': request.id,
            'scope': request.scope.model_dump(), 'approvedAt': now, 'executeBefore': request.expiresAt,
            'approvalContentDigest': request.selectedContentDigest,
            'changes': [change.model_dump() for change in request.proposedChanges],
            'expectedTaskFacts': request.preconditions.expectedTaskFacts.model_dump(),
            'policyValidation': {'version': request.policyVersion, 'evaluatedAt': request.evaluatedAt,
                'checks': [check.model_dump() for check in request.proposedChanges[0].policyChecks]},
            'authorizationReference': request.id,
        })
    return ApprovalDecisionResult(status=status, request=decided, changeSet=change_set)
