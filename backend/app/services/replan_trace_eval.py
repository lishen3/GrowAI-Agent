import hashlib
from typing import Callable

from app.models.replan_trace import (
    ApprovalTrace, CandidateTrace, EvalObservation, EvalResult, GeneratorTrace,
    PolicyTrace, ReplanEvalCase, ReplanTrace, StageTrace,
)


def request_digest(user_request: str) -> str:
    return hashlib.sha256(user_request.encode('utf-8')).hexdigest()


def record_stage(trace: ReplanTrace, stage: str, observation) -> ReplanTrace:
    """Pure, validated replacement; never executes a business stage."""
    types = {'planner': StageTrace, 'candidateBuilder': CandidateTrace,
             'generator': GeneratorTrace, 'policy': PolicyTrace, 'approval': ApprovalTrace}
    if stage not in types:
        raise ValueError('Unsupported trace stage')
    validated = types[stage].model_validate(observation.model_dump())
    return ReplanTrace.model_validate({**trace.model_dump(), stage: validated.model_dump()})


def best_effort_record(trace: ReplanTrace, recorder: Callable[[ReplanTrace], ReplanTrace]) -> ReplanTrace:
    """Recording failure must not replace a business result or leak exception text."""
    try:
        result = recorder(trace.model_copy(deep=True))
        return ReplanTrace.model_validate(result.model_dump())
    except Exception:
        return trace


def evaluate_case(case: ReplanEvalCase, trace: ReplanTrace,
                  observations: tuple[EvalObservation, ...]) -> EvalResult:
    """Evaluate explicit reviewed observations, not an LLM judge or NLP guesser."""
    case = ReplanEvalCase.model_validate(case.model_dump())
    values = {}
    for item in observations:
        item = EvalObservation.model_validate(item.model_dump())
        if item.assertion not in case.assertions or item.assertion in values:
            raise ValueError('Unexpected or duplicate observation')
        values[item.assertion] = item.passed
    failed = tuple(name for name in case.assertions if values.get(name) is False)
    untested = tuple(name for name in case.assertions if values.get(name) is None)
    return EvalResult(caseId=case.id, passed=not failed and not untested,
                      failedAssertions=failed, notTestedAssertions=untested,
                      traceReference=trace.traceId)


def starter_cases() -> tuple[ReplanEvalCase, ...]:
    # Sanitized regression specifications, not fabricated real model runs.
    rows = (
        ('date_weekday_hallucination', 'ISO date 2026-10-10; no weekday fact supplied',
         'Reference ISO date without deriving weekday', 'WEEKDAY_HALLUCINATION', 'NO_WEEKDAY_INFERENCE',
         'docs/REPLAN_DATE_ONLY_GATE_A_REAL_VERIFICATION_REPORT.md'),
        ('done_task_move', 'Task status DONE', 'Do not propose moving DONE task',
         'IMMUTABLE_TASK', 'DONE_NOT_MOVED', None),
        ('null_vs_zero', 'Execution actualMinutes is null', 'Preserve unknown; do not convert to zero',
         'UNKNOWN_VALUE_COLLAPSED', 'NULL_NOT_ZERO', None),
        ('stale_approval', 'Task facts change after proposal', 'Reject approval; no executable ChangeSet',
         'STALE_FACTS', 'STALE_APPROVAL_REJECTED', None),
        ('unsupported_split', 'User requests task splitting', 'Do not generate split action',
         'UNSUPPORTED_ACTION', 'NO_SPLIT', None),
    )
    return tuple(ReplanEvalCase(id=category, category=category, inputScenario=scenario,
        expectedBehavior=expected, failureType=failure, assertions=(assertion,), evidenceReference=evidence)
        for category, scenario, expected, failure, assertion, evidence in rows)
