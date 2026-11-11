from abc import ABC, abstractmethod

from app.models.analysis import WeeklyAnalysisResult
from app.models.actions import ProposalDraft
from app.models.context import AgentContext
from app.models.reflection import WeeklyReflectionDraft
from app.models.replan import WeeklyReplanDraft
from app.models.replan_stages import ReplanPlannerDraft, ReplanActionBatch
from app.models.planner_lite import PlannerLiteDraft
from app.models.lite_generator import LiteGeneratorDraft
from app.models.time_replan import TimeMoveDraft, CreateAndScheduleDraft
from app.services.prompt_builder import WeeklyAnalysisPrompt


class LLMProviderError(Exception):
    code = "LLM_PROVIDER_ERROR"


class LLMTimeoutError(LLMProviderError):
    code = "LLM_TIMEOUT"


class LLMAuthenticationError(LLMProviderError):
    code = "LLM_AUTHENTICATION_FAILED"


class LLMRateLimitError(LLMProviderError):
    code = "LLM_RATE_LIMITED"


class InvalidStructuredOutputError(LLMProviderError):
    code = "INVALID_STRUCTURED_OUTPUT"


class LLMProvider(ABC):
    async def propose_create_and_schedule(self, prompt: WeeklyAnalysisPrompt) -> CreateAndScheduleDraft:
        raise LLMProviderError('此 Provider 尚不支持新建任务排程提案')

    async def propose_time_move(self, prompt: WeeklyAnalysisPrompt) -> TimeMoveDraft:
        raise LLMProviderError('此 Provider 尚不支持时间表调整')

    async def generate_replan_lite_actions(self, prompt: WeeklyAnalysisPrompt) -> LiteGeneratorDraft:
        raise LLMProviderError('此 Provider 尚不支持 Lite Action Generator')

    async def plan_replan_lite(self, prompt: WeeklyAnalysisPrompt) -> PlannerLiteDraft:
        raise LLMProviderError('此 Provider 尚不支持 Planner Lite')

    async def plan_replan(self, prompt: WeeklyAnalysisPrompt) -> ReplanPlannerDraft:
        raise LLMProviderError('此 Provider 尚不支持重排规划阶段')

    async def generate_replan_actions(self, prompt: WeeklyAnalysisPrompt) -> ReplanActionBatch:
        raise LLMProviderError('此 Provider 尚不支持重排动作生成阶段')

    async def replan_weekly(self, prompt: WeeklyAnalysisPrompt) -> WeeklyReplanDraft:
        raise LLMProviderError('此 Provider 尚不支持结构化重排')

    async def reflect_weekly(self, prompt: WeeklyAnalysisPrompt) -> WeeklyReflectionDraft:
        raise LLMProviderError('此 Provider 尚不支持结构化复盘')

    async def propose_actions(self, context: AgentContext, user_message: str, tools: list[dict]) -> ProposalDraft:
        raise LLMProviderError('此 Provider 尚不支持 Tool Calling')

    @abstractmethod
    async def analyze_weekly(self, prompt: WeeklyAnalysisPrompt) -> WeeklyAnalysisResult:
        raise NotImplementedError
