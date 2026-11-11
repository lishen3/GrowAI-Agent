from dataclasses import dataclass
from time import monotonic
from uuid import uuid4

from app.agent.tools.registry import TOOL_REGISTRY
from app.models.actions import ActionAuthorization, AgentAction, AgentActionProposal, ProposalDraft
from app.models.context import AgentContext


@dataclass
class PendingAction:
    action: AgentAction
    context: AgentContext
    expires_at: float
    status: str = 'PROPOSED'
    replan: bool = False


class AgentActionService:
    """Short-lived one-use authorizations. No task database or execution capability."""

    def __init__(self):
        self.pending: dict[str, PendingAction] = {}

    @staticmethod
    def validate(action, context: AgentContext) -> dict:
        tool = TOOL_REGISTRY.get(action.toolName)
        if tool is None:
            raise ValueError('未知工具')
        arguments = tool.validate(action.arguments)
        if action.toolName == 'update_task':
            task = next((task for task in context.tasks if task.id == arguments['taskId']), None)
            if task is None:
                raise ValueError('任务不在当前上下文中')
            if task.status in ('DONE', 'CANCELLED'):
                raise ValueError('不能修改已完成或取消的任务')
        if action.toolName == 'create_task' and arguments.get('weeklyGoalId'):
            if not any(goal.id == arguments['weeklyGoalId'] for goal in context.weeklyGoals):
                raise ValueError('周目标不在当前上下文中')
        category_id = arguments.get('categoryId') if action.toolName == 'create_task' else arguments.get('changes', {}).get('categoryId')
        if category_id and not any(row.id == category_id and row.journeyId == context.journey.id and row.status == 'ACTIVE' for row in (context.categories or [])):
            raise ValueError('分类不属于当前可用注册表')
        return arguments

    def propose(self, draft: ProposalDraft, context: AgentContext, *, replan: bool = False) -> AgentActionProposal:
        self.pending = {key: item for key, item in self.pending.items() if item.expires_at > monotonic()}
        if len(self.pending) + len(draft.actions) > 1000:
            raise ValueError('待确认操作过多，请稍后重试')
        # Validate the entire proposal before retaining any action.
        if replan:
            from app.services.replan_policy import validate_replan_actions
            validate_replan_actions(context, draft.actions)
        actions = [AgentAction(id=uuid4().hex, toolName=item.toolName,
                    arguments=self.validate(item, context), reason=item.reason) for item in draft.actions]
        for action in actions:
            self.pending[action.id] = PendingAction(action, context.model_copy(deep=True), monotonic() + 900, replan=replan)
        return AgentActionProposal(message=draft.message, actions=actions)

    def authorize(self, action_id: str, approval: bool) -> ActionAuthorization:
        item = self.pending.get(action_id)
        if item is None or item.expires_at <= monotonic():
            raise ValueError('操作不存在或已过期，请重新生成建议')
        if item.status != 'PROPOSED':
            raise ValueError('操作已处理，不能重复批准或执行')
        if approval:
            self.validate(item.action, item.context)
            if item.replan:
                from app.services.replan_policy import validate_replan_actions
                validate_replan_actions(item.context, [item.action])
        item.status = 'APPROVED' if approval else 'REJECTED'
        return ActionAuthorization(actionId=action_id, status=item.status,
                                   periodId=item.context.currentPeriod.id, action=item.action)
