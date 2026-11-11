from datetime import date

from app.models.actions import ActionDraft
from app.models.context import AgentContext
from app.models.lite_generator import DateOnlyChanges, LiteGeneratorDraft
from app.services.replan_policy import validate_replan_actions


def validate_scheduling_context(context: AgentContext) -> None:
    schedule = context.schedule
    if schedule is None:
        raise ValueError('DateOnly 重排需要完整的 SchedulingContext')
    if (schedule.weekStart != context.currentWeek.windowStart
            or schedule.weekEnd != context.currentWeek.windowEnd):
        raise ValueError('SchedulingContext 窗口与当前周不一致')

    try:
        week_start = date.fromisoformat(DateOnlyChanges(plannedDate=schedule.weekStart).plannedDate)
        week_end = date.fromisoformat(DateOnlyChanges(plannedDate=schedule.weekEnd).plannedDate)
        period_start = date.fromisoformat(DateOnlyChanges(plannedDate=context.currentPeriod.startDate).plannedDate)
        period_end = date.fromisoformat(DateOnlyChanges(plannedDate=context.currentPeriod.endDate).plannedDate)
    except (ValueError, TypeError) as error:
        raise ValueError('SchedulingContext 或 Period 日期无效') from error

    start = max(week_start, period_start)
    end = min(week_end, period_end)
    if start > end:
        raise ValueError('SchedulingContext 不在当前 Period 范围内')

    seen_event_ids = set()
    for event in schedule.events:
        if not event.eventId.strip() or event.eventId in seen_event_ids:
            raise ValueError('SchedulingContext 包含空或重复的 eventId')
        seen_event_ids.add(event.eventId)
        try:
            event_date = date.fromisoformat(DateOnlyChanges(plannedDate=event.date).plannedDate)
        except (ValueError, TypeError) as error:
            raise ValueError('SchedulingContext 包含无效事件日期') from error
        if not start <= event_date <= end:
            raise ValueError('SchedulingContext 事件超出当前 Period 周窗口')
        if event.kind in ('TASK', 'AI_ADJUSTMENT') and not event.taskId.strip():
            raise ValueError('SchedulingContext 事件缺少 taskId')


def validate_date_only_actions(context: AgentContext, draft: LiteGeneratorDraft, *,
                               candidate_task_ids: set[str], runtime_date: str,
                               task_constraints: dict[str, dict], allowed_dates: set[str]) -> None:
    """Pure validation; callers supply application-owned dates and task facts, never model claims."""
    draft = LiteGeneratorDraft.model_validate(draft.model_dump())
    validate_scheduling_context(context)
    today = date.fromisoformat(DateOnlyChanges(plannedDate=runtime_date).plannedDate)
    start = max(date.fromisoformat(context.currentWeek.windowStart), date.fromisoformat(context.currentPeriod.startDate))
    end = min(date.fromisoformat(context.currentWeek.windowEnd), date.fromisoformat(context.currentPeriod.endDate))
    if context.currentPeriod.status != 'ACTIVE' or not start <= today <= end:
        raise ValueError('当前阶段或运行周已失效')
    permitted = {date.fromisoformat(DateOnlyChanges(plannedDate=value).plannedDate) for value in allowed_dates}
    tasks = {task.id: task for task in context.tasks}
    if len(tasks) != len(context.tasks):
        raise ValueError('上下文任务 ID 重复')
    seen = set()
    actions = []
    for action in draft.actions:
        task_id = action.arguments.taskId
        task = tasks.get(task_id)
        if task is None or task_id not in candidate_task_ids:
            raise ValueError('任务不在候选范围中')
        if task.status not in ('TODO', 'DELAYED'):
            raise ValueError('任务状态不可日期重排')
        if task_id in seen:
            raise ValueError('同一任务不能包含多个动作')
        seen.add(task_id)
        original = date.fromisoformat(DateOnlyChanges(plannedDate=task.plannedDate).plannedDate)
        target = date.fromisoformat(action.arguments.changes.plannedDate)
        if not start <= original <= end or not max(start, today) <= target <= end:
            raise ValueError('任务日期不在当前周或阶段允许窗口内')
        if target == original:
            raise ValueError('原日期不能作为修改结果')
        if target not in permitted:
            raise ValueError('目标日期不在用户允许范围中')
        constraints = task_constraints.get(task_id)
        if (not isinstance(constraints, dict) or 'deadline' not in constraints
                or constraints.get('periodId') != context.currentPeriod.id):
            raise ValueError('任务阶段或截止事实缺失')
        deadline = constraints['deadline']
        if deadline is not None:
            limit = date.fromisoformat(DateOnlyChanges(plannedDate=deadline).plannedDate)
            if target > limit:
                raise ValueError('目标日期超过任务截止日期')
        actions.append(ActionDraft(toolName=action.toolName,
                                   arguments=action.arguments.model_dump(), reason=action.reason))
    validate_replan_actions(context, actions)
