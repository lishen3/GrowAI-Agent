from app.models.context import AgentContext
from app.models.replan import ReplanImpact
from app.services.agent_action_service import AgentActionService


def validate_replan_actions(context: AgentContext, actions) -> None:
    updated = set()
    for action in actions:
        args = AgentActionService.validate(action, context)
        changes = args['changes'] if action.toolName == 'update_task' else args
        if changes.get('estimatedMinutes') == 0:
            raise ValueError('重排不能用零时长模拟删除任务')
        planned_date = changes.get('plannedDate')
        if planned_date is not None and not context.currentWeek.windowStart <= planned_date <= context.currentWeek.windowEnd:
            raise ValueError('当前版本只重排本周任务')
        if action.toolName == 'create_task' and planned_date is None:
            raise ValueError('新增重排任务必须指定本周日期')
        if action.toolName == 'update_task':
            if args['taskId'] in updated:
                raise ValueError('同一任务不能包含多个重排操作')
            updated.add(args['taskId'])


def calculate_replan_impact(context: AgentContext, actions) -> ReplanImpact:
    validate_replan_actions(context, actions)
    durations = {task.id: task.estimatedMinutes for task in context.tasks if task.status != 'CANCELLED'}

    def total(values):
        values = list(values)
        return None if not values or any(value is None for value in values) else sum(values)

    before = total(durations.values())
    additions = []
    for action in actions:
        args = AgentActionService.validate(action, context)
        if action.toolName == 'create_task':
            additions.append(args.get('estimatedMinutes'))
        elif 'estimatedMinutes' in args['changes']:
            durations[args['taskId']] = args['changes']['estimatedMinutes']
    return ReplanImpact(beforePlannedMinutes=before, afterPlannedMinutes=total([*durations.values(), *additions]), affectedTaskCount=len(actions))
