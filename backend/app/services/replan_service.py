import asyncio

from app.llm.base import LLMTimeoutError
from app.models.actions import ProposalDraft
from app.models.context import AgentContext
from app.models.replan import WeeklyReplanProposal
from app.services.replan_policy import calculate_replan_impact
from app.models.replan_stages import ReplanPlannerDraft, ReplanActionBatch
from app.services.replan_planner_prompt import build_replan_planner_prompt
from app.services.replan_action_prompt import build_replan_action_prompt
from app.services.replan_stages import validate_planner, assemble_replan


class WeeklyReplanService:
    def __init__(self, provider, actions, *, deadline_seconds: float = 65.0):
        self.provider = provider
        self.actions = actions
        self.deadline_seconds = deadline_seconds

    async def propose(self, context: AgentContext, user_message: str) -> WeeklyReplanProposal:
        context = context.model_copy(deep=True)
        stage = 'Planner'
        deadline = asyncio.timeout(self.deadline_seconds)
        try:
            async with deadline:
                plan = ReplanPlannerDraft.model_validate(await self.provider.plan_replan(build_replan_planner_prompt(context, user_message)))
                validate_planner(context, plan)
                stage = 'Action Generator'
                batch = ReplanActionBatch(actions=[])
                if plan.adjustmentIntents:
                    batch = ReplanActionBatch.model_validate(await self.provider.generate_replan_actions(build_replan_action_prompt(context, plan)))
                draft = assemble_replan(context, plan, batch)
            if deadline.expired() or asyncio.get_running_loop().time() >= deadline.when():
                raise TimeoutError('late completion')
        except TimeoutError as error:
            raise LLMTimeoutError(f'{stage} 超过整次重排时间预算') from error
        ids = {memory.id for memory in context.memories}
        if any(memory_id not in ids for strategy in draft.strategy for memory_id in strategy.basedOnMemoryIds):
            raise ValueError('策略引用了不存在的记忆')
        action_drafts = draft.action_drafts()
        impact = calculate_replan_impact(context, action_drafts)
        if asyncio.get_running_loop().time() >= deadline.when():
            raise LLMTimeoutError('最终校验超过整次重排时间预算')
        # Only after full validation: use the pending authorization store.
        proposal = self.actions.propose(ProposalDraft(message=draft.summary, actions=action_drafts), context, replan=True)
        return WeeklyReplanProposal(summary=draft.summary, diagnosis=draft.diagnosis,
                                    strategy=draft.strategy, expectedChanges=impact, actions=proposal.actions)
