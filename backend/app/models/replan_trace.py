from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, StrictBool, StringConstraints, model_validator

from app.models.replan_approval import ApprovalStatus, ContractModel, PolicyCheck

Digest = Annotated[str, StringConstraints(strict=True, pattern=r'^[0-9a-f]{64}$')]
Reference = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=120)]
StageStatus = Literal['NOT_STARTED', 'SUCCESS', 'FAILED', 'BLOCKED']


class TraceRequest(ContractModel):
    # Digest only: never the original user request.
    userRequest: Digest
    requestType: Literal['DATE_ONLY', 'NO_CHANGE', 'UNSUPPORTED']


class TraceContext(ContractModel):
    contextVersion: Reference
    contextDigest: Digest
    snapshotInfo: Literal['HISTORICAL_DEMO', 'LIVE', 'SYNTHETIC_TEST']


class StageTrace(ContractModel):
    status: StageStatus = 'NOT_STARTED'
    latency: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    outputDigest: Digest | None = None
    errorCode: Literal['TIMEOUT', 'INVALID_OUTPUT', 'POLICY_REJECTED', 'UNAVAILABLE', 'UNKNOWN'] | None = None

    @model_validator(mode='after')
    def consistent_status(self):
        if self.status == 'NOT_STARTED' and any(v is not None for v in (self.latency, self.outputDigest, self.errorCode)):
            raise ValueError('Unstarted stage cannot contain observations')
        if self.status == 'SUCCESS' and self.errorCode is not None:
            raise ValueError('Successful stage cannot contain an error')
        if self.status in ('FAILED', 'BLOCKED') and self.errorCode is None:
            raise ValueError('Failure needs a safe error code')
        return self


class CandidateRejection(ContractModel):
    taskReference: Reference
    reason: Literal['IMMUTABLE_STATUS', 'OUTSIDE_AREA', 'INVALID_DATE', 'MISSING_FACTS', 'OTHER']


class CandidateTrace(StageTrace):
    candidates: tuple[Reference, ...] = ()
    rejectedReasons: tuple[CandidateRejection, ...] = ()


class ActionTrace(ContractModel):
    # No task title, description or model reason; reference must be pseudonymous.
    taskReference: Reference
    toolName: Literal['update_task'] = 'update_task'
    plannedDate: str

    @model_validator(mode='after')
    def valid_date(self):
        from app.models.lite_generator import DateOnlyChanges
        DateOnlyChanges(plannedDate=self.plannedDate)
        return self


class GeneratorTrace(StageTrace):
    actions: tuple[ActionTrace, ...] = Field(default=(), max_length=3)


class PolicyTrace(StageTrace):
    checks: tuple[PolicyCheck, ...] = ()
    result: Literal['PASS', 'FAIL'] | None = None

    @model_validator(mode='after')
    def consistent_checks(self):
        if self.result == 'PASS' and (self.status != 'SUCCESS' or len(self.checks) != 2
                or {c.name for c in self.checks} != {'DATE_ONLY', 'GENERAL_REPLAN'}
                or any(c.result != 'PASS' for c in self.checks)):
            raise ValueError('PASS requires both observed passing checks')
        return self


class ApprovalTrace(ContractModel):
    approvalId: Reference
    status: ApprovalStatus


class TraceMetadata(ContractModel):
    createdAt: AwareDatetime
    model: Reference
    promptVersion: Reference


class ReplanTrace(ContractModel):
    traceId: Reference
    request: TraceRequest
    context: TraceContext
    metadata: TraceMetadata
    planner: StageTrace = Field(default_factory=StageTrace)
    candidateBuilder: CandidateTrace = Field(default_factory=CandidateTrace)
    generator: GeneratorTrace = Field(default_factory=GeneratorTrace)
    policy: PolicyTrace = Field(default_factory=PolicyTrace)
    approval: ApprovalTrace | None = None
    execution: None = None


AssertionName = Literal['NO_WEEKDAY_INFERENCE', 'DONE_NOT_MOVED', 'NULL_NOT_ZERO',
                        'STALE_APPROVAL_REJECTED', 'NO_SPLIT']


class ReplanEvalCase(ContractModel):
    id: Reference
    category: Literal['date_weekday_hallucination', 'done_task_move', 'null_vs_zero',
                      'stale_approval', 'unsupported_split']
    inputScenario: Reference
    expectedBehavior: Reference
    failureType: Reference
    assertions: tuple[AssertionName, ...] = Field(min_length=1)
    evidenceReference: Reference | None = None

    @model_validator(mode='after')
    def unique_assertions(self):
        if len(set(self.assertions)) != len(self.assertions):
            raise ValueError('Duplicate assertions')
        return self


class EvalObservation(ContractModel):
    assertion: AssertionName
    passed: StrictBool | None


class EvalResult(ContractModel):
    caseId: Reference
    passed: StrictBool
    failedAssertions: tuple[AssertionName, ...]
    notTestedAssertions: tuple[AssertionName, ...]
    traceReference: Reference
