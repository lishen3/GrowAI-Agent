from typing import Literal

from pydantic import AwareDatetime, ConfigDict, Field, StrictInt, model_validator

from app.models.context import Category, Priority, StrictModel
from app.models.lite_generator import DateOnlyChanges
from app.models.reflection import Text

ApprovalStatus = Literal['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'INVALID']


class ContractModel(StrictModel):
    model_config = ConfigDict(extra='forbid', frozen=True)


class ApprovalScope(ContractModel):
    journeyId: Text
    periodId: Text
    weekStart: str
    weekEnd: str
    dataSpace: Literal['PERSONAL', 'DEMO']
    sessionId: Text
    resetEpoch: StrictInt = Field(ge=0)

    @model_validator(mode='after')
    def valid_window(self):
        DateOnlyChanges(plannedDate=self.weekStart)
        DateOnlyChanges(plannedDate=self.weekEnd)
        if self.weekStart > self.weekEnd:
            raise ValueError('Invalid week window')
        return self


class PolicyCheck(ContractModel):
    name: Literal['DATE_ONLY', 'GENERAL_REPLAN']
    result: Literal['PASS', 'FAIL']


class ApprovalDateOnly(DateOnlyChanges):
    model_config = ConfigDict(extra='forbid', frozen=True)


class ProposedChange(ContractModel):
    id: Text
    taskId: Text
    toolName: Literal['update_task'] = 'update_task'
    before: ApprovalDateOnly
    after: ApprovalDateOnly
    reason: Text
    policyChecks: tuple[PolicyCheck, ...]

    @model_validator(mode='after')
    def valid_change(self):
        if self.before == self.after:
            raise ValueError('Date change must not be a no-op')
        if len(self.policyChecks) != 2 or {check.name for check in self.policyChecks} != {'DATE_ONLY', 'GENERAL_REPLAN'}:
            raise ValueError('Both policy checks are required')
        if any(check.result != 'PASS' for check in self.policyChecks):
            raise ValueError('Policy checks must pass')
        return self


class TaskSnapshot(ContractModel):
    categoryId: str | None = Field(default=None, min_length=1)
    # Internal source snapshot, not a new database Task model or public Context.
    id: Text
    periodId: Text
    periodGoalId: str | None
    weeklyGoalId: str | None
    title: Text
    description: str | None
    category: Category
    priority: Priority
    status: Literal['TODO', 'DOING', 'DONE', 'DELAYED', 'CANCELLED']
    plannedDate: str | None
    estimatedMinutes: StrictInt | None = Field(ge=0)
    deadline: str | None
    createdAt: str
    startedAt: str | None
    completedAt: str | None


class AllowedDatesEvidence(ContractModel):
    dates: tuple[str, ...]
    sourceType: Literal['USER']
    confirmationReference: Text

    @model_validator(mode='after')
    def valid_dates(self):
        if len(set(self.dates)) != len(self.dates):
            raise ValueError('Duplicate allowed dates')
        for value in self.dates:
            DateOnlyChanges(plannedDate=value)
        return self


class ApprovalPreconditions(ContractModel):
    expectedTaskFacts: TaskSnapshot
    sourceContextDigest: Text


class ApprovalRequest(ContractModel):
    id: Text
    sourceType: Literal['REPLAN_DATE_ONLY']
    sourceDraftId: Text
    traceId: Text | None = None
    createdAt: AwareDatetime
    expiresAt: AwareDatetime
    status: ApprovalStatus
    scope: ApprovalScope
    proposedChanges: tuple[ProposedChange, ...] = Field(min_length=1, max_length=1)
    selectedContentDigest: Text
    allowedDatesEvidence: AllowedDatesEvidence
    preconditions: ApprovalPreconditions
    policyVersion: Text
    evaluatedAt: AwareDatetime
    decidedAt: AwareDatetime | None = None
    invalidReason: str | None = None

    @model_validator(mode='after')
    def consistent_request(self):
        if not self.evaluatedAt <= self.createdAt < self.expiresAt:
            raise ValueError('Invalid approval timestamps')
        task = self.preconditions.expectedTaskFacts
        change = self.proposedChanges[0]
        if task.id != change.taskId or task.periodId != self.scope.periodId or task.plannedDate != change.before.plannedDate:
            raise ValueError('Before facts do not match the source task')
        if task.status not in ('TODO', 'DELAYED'):
            raise ValueError('Task status cannot be approved')
        if not self.scope.weekStart <= change.before.plannedDate <= self.scope.weekEnd:
            raise ValueError('Original date is outside the week')
        if not self.scope.weekStart <= change.after.plannedDate <= self.scope.weekEnd:
            raise ValueError('Target date is outside the week')
        if change.after.plannedDate not in self.allowedDatesEvidence.dates:
            raise ValueError('Target date lacks user evidence')
        if self.status in ('DRAFT', 'PENDING') and (self.decidedAt is not None or self.invalidReason is not None):
            raise ValueError('Undecided request contains a decision')
        return self


class PolicyValidation(ContractModel):
    version: Text
    evaluatedAt: AwareDatetime
    checks: tuple[PolicyCheck, ...]


class ApprovedChangeSet(ContractModel):
    id: Text
    approvalRequestId: Text
    scope: ApprovalScope
    approvedAt: AwareDatetime
    executeBefore: AwareDatetime
    approvalContentDigest: Text
    changes: tuple[ProposedChange, ...] = Field(min_length=1, max_length=1)
    expectedTaskFacts: TaskSnapshot
    policyValidation: PolicyValidation
    authorizationReference: Text


class ApprovalDecisionResult(ContractModel):
    status: ApprovalStatus
    request: ApprovalRequest | None
    changeSet: ApprovedChangeSet | None = None
    error: str | None = None
