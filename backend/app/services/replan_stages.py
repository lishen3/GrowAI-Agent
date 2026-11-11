from app.models.context import AgentContext
from app.models.replan import WeeklyReplanDraft
from app.models.replan_stages import ReplanActionBatch, ReplanPlannerDraft
from app.services.replan_policy import validate_replan_actions


def validate_planner(context: AgentContext, plan: ReplanPlannerDraft) -> None:
    memory_ids = {memory.id for memory in context.memories}
    if any(key not in memory_ids for strategy in plan.strategy for key in strategy.basedOnMemoryIds):
        raise ValueError('策略引用了不存在的记忆')
    tasks = {task.id: task for task in context.tasks}
    goals = {goal.id for goal in context.weeklyGoals}
    updated = set()
    for intent in plan.adjustmentIntents:
        if intent.plannedDate is not None and not context.currentWeek.windowStart <= intent.plannedDate <= context.currentWeek.windowEnd:
            raise ValueError('当前版本只重排本周任务')
        if intent.kind == 'create':
            if intent.weeklyGoalId and intent.weeklyGoalId not in goals:
                raise ValueError('周目标不在当前上下文中')
            continue
        task = tasks.get(intent.taskId)
        if not task or task.status not in ('TODO', 'DOING', 'DELAYED'):
            raise ValueError('不能调整不存在、已完成或取消的任务')
        if task.id in updated:
            raise ValueError('同一任务不能包含多个重排意图')
        updated.add(task.id)
        if intent.durationDirection == 'reduce':
            if task.estimatedMinutes is None:
                raise ValueError('未知时长不能宣称缩短')
            if intent.estimatedMinutes is not None and intent.estimatedMinutes >= task.estimatedMinutes:
                raise ValueError('缩短时长意图与精确值不一致')
        if intent.durationDirection == 'preserve' and intent.estimatedMinutes is not None and intent.estimatedMinutes != task.estimatedMinutes:
            raise ValueError('保留时长意图与精确值不一致')


def assemble_replan(context: AgentContext, plan: ReplanPlannerDraft, batch: ReplanActionBatch) -> WeeklyReplanDraft:
    expected = set(range(len(plan.adjustmentIntents)))
    indexes = [item.intentIndex for item in batch.actions]
    if len(indexes) != len(expected) or set(indexes) != expected:
        raise ValueError('生成动作与规划意图不一一对应')
    tasks = {task.id: task for task in context.tasks}
    ordered = sorted(batch.actions, key=lambda item: item.intentIndex)
    for item in ordered:
        intent = plan.adjustmentIntents[item.intentIndex]
        action = item.action
        if action.reason != intent.reason:
            raise ValueError('生成动作改变了规划理由')
        if intent.kind == 'update':
            if action.toolName != 'update_task' or action.arguments.taskId != intent.taskId:
                raise ValueError('生成动作改变了目标任务或操作类型')
            changes = action.arguments.changes.model_dump(exclude_unset=True)
            if not set(changes) <= set(intent.allowedFields):
                raise ValueError('生成动作越过允许调整的字段')
            values = changes
            old = tasks[intent.taskId].estimatedMinutes
            if intent.durationDirection == 'reduce' and ('estimatedMinutes' not in changes or changes['estimatedMinutes'] >= old):
                raise ValueError('生成动作未缩短指定时长')
            if intent.durationDirection == 'preserve' and 'estimatedMinutes' in changes and changes['estimatedMinutes'] != old:
                raise ValueError('生成动作改变了应保留的时长')
        else:
            if action.toolName != 'create_task':
                raise ValueError('生成动作改变了操作类型')
            values = action.arguments.model_dump(exclude_none=True)
            if values['title'] != intent.title or values['category'] != intent.category or values.get('weeklyGoalId') != intent.weeklyGoalId:
                raise ValueError('生成动作改变了新任务的主题、分类或目标')
        for name in ('estimatedMinutes', 'plannedDate', 'title', 'description'):
            constraint = getattr(intent, name, None)
            if constraint is not None and values.get(name) != constraint:
                raise ValueError('生成动作违反了精确字段约束')
    draft = WeeklyReplanDraft.model_validate({
        'summary': plan.summary, 'diagnosis': [item.model_dump() for item in plan.diagnosis],
        'strategy': [item.model_dump() for item in plan.strategy],
        'actions': [item.action.model_dump(exclude_unset=True) for item in ordered],
    })
    validate_replan_actions(context, draft.action_drafts())
    return draft
