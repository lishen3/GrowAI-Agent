from app.llm.base import LLMProvider
from app.models.context import AgentContext
from app.models.planner_lite import PlannerLiteDraft
from app.services.planner_lite_prompt import build_planner_lite_prompt


class PlannerLiteService:
    """Internal planning only; no Generator, authorization store or database access."""

    def __init__(self, provider: LLMProvider):
        self.provider = provider

    async def plan(self, context: AgentContext, user_message: str) -> PlannerLiteDraft:
        if not user_message.strip() or len(user_message) > 2000:
            raise ValueError('本轮需求必须为1至2000字符的非空文字')
        snapshot = context.model_copy(deep=True)
        raw = await self.provider.plan_replan_lite(build_planner_lite_prompt(snapshot, user_message.strip()))
        # Also validate injected providers' results, not just HTTP adapter results.
        draft = PlannerLiteDraft.model_validate(raw.model_dump() if isinstance(raw, PlannerLiteDraft) else raw)
        memory_ids = {memory.id for memory in snapshot.memories}
        if any(key not in memory_ids for strategy in draft.strategy for key in strategy.basedOnMemoryIds):
            raise ValueError('策略引用了不存在的记忆')
        return draft
