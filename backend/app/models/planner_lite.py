from typing import Annotated

from pydantic import Field, StringConstraints, field_validator, model_validator

from app.models.context import Category, StrictModel
from app.models.reflection import Text
from app.models.replan import ReplanStrategy

LiteText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
LiteReason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]


class PlannerLiteStrategy(ReplanStrategy):
    statement: LiteText
    reason: LiteReason
    basedOnMemoryIds: list[Text] = Field(max_length=3)

    @field_validator('basedOnMemoryIds')
    @classmethod
    def unique_memory_ids(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError('记忆引用不能重复')
        return value


class PlannerLiteDraft(StrictModel):
    summary: LiteText
    strategy: list[PlannerLiteStrategy] = Field(max_length=1)
    targetAreas: list[Category] = Field(max_length=3)

    @field_validator('targetAreas')
    @classmethod
    def unique_areas(cls, value: list[Category]) -> list[Category]:
        if len(value) != len(set(value)):
            raise ValueError('调整领域不能重复')
        return value

    @model_validator(mode='after')
    def require_strategy_for_target_areas(self):
        if self.targetAreas and not self.strategy:
            raise ValueError('有调整领域时必须提供一条策略')
        return self
