"""Ground structured identifiers/values, not unrestricted natural-language truth claims."""
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone

from app.models.context import AgentContext
from app.models.reflection import WeeklyReflectionDraft


class ReflectionEvidenceError(ValueError):
    """Static diagnostic code only; never include context or model output."""

    def __init__(self, rule: str):
        self.rule = rule
        super().__init__('Invalid reflection evidence')


def validate_growth_reflection(context: AgentContext, draft: WeeklyReflectionDraft) -> None:
    def fail(rule='EVIDENCE_INVALID'):
        raise ReflectionEvidenceError(rule)

    if draft.growth is None:
        fail('GROWTH_REQUIRED')
    start, end = context.currentWeek.windowStart, context.currentWeek.windowEnd
    if context.reviewFacts.windowStart != start or context.reviewFacts.windowEnd != end:
        fail()
    # Offset-aware device-local midnight bounds avoid server timezone / Windows tzdata assumptions.
    if context.reflectionWindow:
        lower = datetime.fromisoformat(context.reflectionWindow.startAt.replace('Z', '+00:00'))
        upper = datetime.fromisoformat(context.reflectionWindow.endExclusiveAt.replace('Z', '+00:00'))
        if (lower.tzinfo is None or upper.tzinfo is None or lower.date().isoformat() != start
                or upper.date() != date.fromisoformat(end) + timedelta(days=1)
                or lower.time().isoformat() != '00:00:00' or upper.time().isoformat() != '00:00:00' or lower >= upper):
            fail()
    else:
        lower = datetime.fromisoformat(start).replace(tzinfo=timezone.utc)
        upper = (datetime.fromisoformat(end) + timedelta(days=1)).replace(tzinfo=timezone.utc)
    records = {}

    def occurred(value):
        stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return stamp.tzinfo is not None and lower <= stamp < upper

    def add(source, row):
        value = row.model_dump()
        key = (source, row.id)
        if key in records and any(field in records[key] and records[key][field] != item for field, item in value.items()):
            fail()
        records[key] = {**records.get(key, {}), **value}

    for source, rows in [('LONG_TERM_GOAL', context.longTermGoals), ('PERIOD_GOAL', context.periodGoals),
                         ('WEEKLY_GOAL', context.weeklyGoals)]:
        for row in rows:
            add(source, row)
    tasks = context.reflectionTasks if context.reflectionTasks is not None else [
        *context.tasks, *context.planVsReality.completedTasks, *context.planVsReality.unfinishedTasks]
    for task in tasks:
        scheduled = context.schedule and any(getattr(row, 'taskId', None) == task.id and start <= row.date <= end for row in context.schedule.events)
        executed = any(row.taskId == task.id and occurred(row.completedAt) for row in context.recentExecutions)
        achieved = any(row.sourceId == task.id and occurred(row.occurredAt) for row in context.recentAchievements)
        if not (scheduled or executed or achieved or (task.plannedDate is not None and start <= task.plannedDate <= end)):
            fail()
        add('TASK', task)
    for task in [*context.tasks, *context.planVsReality.completedTasks, *context.planVsReality.unfinishedTasks]:
        if ('TASK', task.id) in records:
            add('TASK', task)
    for source, rows, field in [('EXECUTION', context.recentExecutions, 'completedAt'),
                                ('ACHIEVEMENT', context.recentAchievements, 'occurredAt')]:
        for row in rows:
            if not occurred(getattr(row, field)):
                fail()
            add(source, row)
    records['STAT', 'reviewFacts'] = context.reviewFacts.model_dump()
    if context.reflectionTotals:
        records['STAT', 'reflectionTotals'] = context.reflectionTotals.model_dump()
    for row in context.reviewFacts.categoryBreakdown:
        records['STAT', 'category:' + (row.categoryId or row.category)] = row.model_dump()

    def verify(refs):
        if not refs:
            fail('REFERENCES_REQUIRED')
        for ref in refs:
            row = records.get((ref.source, ref.id))
            if row is None:
                fail('REFERENCE_RECORD_UNKNOWN')
            if ref.field not in row:
                fail('REFERENCE_FIELD_UNKNOWN')
            if row[ref.field] != ref.value:
                fail('REFERENCE_VALUE_MISMATCH')
            if isinstance(row[ref.field], bool) != isinstance(ref.value, bool):
                fail('REFERENCE_VALUE_TYPE_MISMATCH')

    for fact in [*draft.facts, *draft.insights]:
        verify(fact.references)
    normalize = lambda value: re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', value).strip()).lower()
    contents = {normalize(row.content) for row in context.memories}
    for candidate in draft.memoryCandidates:
        verify(candidate.references)
        content = normalize(candidate.content)
        if content in contents:
            fail()
        contents.add(content)
    seen = set()
    for analysis in draft.growth.goalAnalyses:
        if ('LONG_TERM_GOAL', analysis.goalId) not in records or analysis.goalId in seen:
            fail()
        seen.add(analysis.goalId)
        verify(analysis.references)
        if not any(ref.source == 'LONG_TERM_GOAL' and ref.id == analysis.goalId for ref in analysis.references):
            fail()
        if analysis.progress == 'INSUFFICIENT':
            if analysis.confidence != 'LOW':
                fail()
        elif not analysis.actions:
            fail()
        if analysis.progress in ('EVIDENCED', 'PARTIAL') and not any(row.claim == 'COMPLETED' for row in analysis.actions):
            fail('PROGRESS_REQUIRES_COMPLETED_ACTION')
        for action in analysis.actions:
            task = records.get(('TASK', action.taskId))
            if not task:
                fail()
            verify(action.references)
            if not any(ref.source == 'TASK' and ref.id == action.taskId for ref in action.references):
                fail()
            for ref in action.references:
                if ref.source == 'EXECUTION' and records['EXECUTION', ref.id]['taskId'] != action.taskId:
                    fail()
                if ref.source == 'ACHIEVEMENT' and records['ACHIEVEMENT', ref.id]['sourceId'] != action.taskId:
                    fail()
            if action.claim == 'COMPLETED' and (task['status'] != 'DONE' or not any(
                ref.source == 'TASK' and ref.id == action.taskId and ref.field == 'status' and ref.value == 'DONE'
                for ref in action.references
            )):
                fail()
            if task['status'] == 'CANCELLED' and analysis.progress != 'INSUFFICIENT':
                fail()
            if analysis.progress == 'EVIDENCED' and action.claim != 'COMPLETED':
                fail()
            if analysis.progress == 'EVIDENCED' and not any(ref.source in ('EXECUTION', 'ACHIEVEMENT') for ref in action.references):
                fail()
            if action.relationship == 'INFERRED' and analysis.confidence == 'HIGH':
                fail()
            if action.relationship == 'DIRECT':
                weekly = records.get(('WEEKLY_GOAL', task['weeklyGoalId']))
                if task['weeklyGoalId'] and not weekly:
                    fail()
                if task.get('periodGoalId') and weekly and task['periodGoalId'] != weekly['periodGoalId']:
                    fail()
                period = records.get(('PERIOD_GOAL', task.get('periodGoalId') or (weekly or {}).get('periodGoalId')))
                if not period or period['longTermGoalId'] != analysis.goalId:
                    fail()
    for suggestion in draft.growth.nextWeekSuggestions:
        verify(suggestion.references)
