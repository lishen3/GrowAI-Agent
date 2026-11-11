from dataclasses import dataclass
from datetime import date

from pydantic import ValidationError

from app.models.context import AgentContext
from app.models.lite_generator import DateOnlyChanges, LiteGeneratorDraft
from app.models.planner_lite import PlannerLiteDraft
from app.services.date_only_policy import validate_date_only_actions


@dataclass
class DateOnlyCandidates:
    candidate_task_ids: set[str]
    allowed_target_dates: dict[str, list[str]]
    excluded_reasons: dict[str, str]


def build_date_only_candidates(context: AgentContext, plan: PlannerLiteDraft, *,
                               runtime_date: str, task_constraints: dict[str, dict],
                               allowed_dates: set[str]) -> DateOnlyCandidates:
    """Pure candidate selection from caller-owned facts; no inference, I/O or execution."""
    plan = PlannerLiteDraft.model_validate(plan.model_dump())
    validate_date_only_actions(context, LiteGeneratorDraft(actions=[]), candidate_task_ids=set(),
                               runtime_date=runtime_date, task_constraints=task_constraints,
                               allowed_dates=allowed_dates)
    today = date.fromisoformat(runtime_date)
    start = max(date.fromisoformat(context.currentWeek.windowStart), date.fromisoformat(context.currentPeriod.startDate))
    end = min(date.fromisoformat(context.currentWeek.windowEnd), date.fromisoformat(context.currentPeriod.endDate))
    # The full current-week query window is the isolation scope; allowed_dates only
    # constrain destinations and must not make existing blocks on other weekdays disappear.
    schedule = context.schedule
    if schedule is None:  # Also narrows the optional contract for static analysis.
        raise ValueError('DateOnly 重排需要完整的 SchedulingContext')
    scheduled_task_ids = {event.taskId for event in schedule.events if event.kind == 'TASK'}
    result = DateOnlyCandidates(set(), {}, {})
    for task in context.tasks:
        if task.category not in plan.targetAreas:
            result.excluded_reasons[task.id] = 'OUTSIDE_AREA'
            continue
        if task.status not in ('TODO', 'DELAYED'):
            result.excluded_reasons[task.id] = 'IMMUTABLE_STATUS'
            continue
        # Do not trust the advisory `adjustable` marker: any persisted TASK event
        # in this Period/week means this DateOnly operation must leave it untouched.
        if task.id in scheduled_task_ids:
            result.excluded_reasons[task.id] = 'HAS_SCHEDULE_EVENT'
            continue
        try:
            original = date.fromisoformat(DateOnlyChanges(plannedDate=task.plannedDate).plannedDate)
        except ValidationError:
            result.excluded_reasons[task.id] = 'OUTSIDE_WINDOW'
            continue
        if not start <= original <= end:
            result.excluded_reasons[task.id] = 'OUTSIDE_WINDOW'
            continue
        constraints = task_constraints.get(task.id)
        if (not isinstance(constraints, dict) or 'deadline' not in constraints
                or constraints.get('periodId') != context.currentPeriod.id):
            result.excluded_reasons[task.id] = 'UNKNOWN_TASK_CONSTRAINT'
            continue
        deadline = constraints['deadline']
        limit = end
        if deadline is not None:
            try:
                limit = min(end, date.fromisoformat(DateOnlyChanges(plannedDate=deadline).plannedDate))
            except ValidationError:
                result.excluded_reasons[task.id] = 'INVALID_DEADLINE'
                continue
        targets = [value for value in sorted(allowed_dates)
                   if max(start, today) <= date.fromisoformat(value) <= limit
                   and value != task.plannedDate]
        if not targets:
            result.excluded_reasons[task.id] = 'NO_ALLOWED_TARGET'
            continue
        for target in targets:
            draft = LiteGeneratorDraft.model_validate({'actions': [{
                'toolName': 'update_task', 'arguments': {'taskId': task.id, 'changes': {'plannedDate': target}},
                'reason': '内部候选预检查，不是执行或授权'}]})
            validate_date_only_actions(context, draft, candidate_task_ids={task.id},
                                       runtime_date=runtime_date, task_constraints=task_constraints,
                                       allowed_dates=allowed_dates)
        result.candidate_task_ids.add(task.id)
        result.allowed_target_dates[task.id] = targets
    return result
