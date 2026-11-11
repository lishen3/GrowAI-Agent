from typing import Annotated, Literal

from pydantic import Field, StrictInt, model_validator

from app.models.actions import CreateTaskArguments
from app.models.context import Category, StrictModel
from app.models.reflection import ReflectionFact, Text
from app.models.replan import CreateReplanAction, ReplanStrategy, UpdateReplanAction

PlanField = Literal['title', 'description', 'plannedDate', 'estimatedMinutes']


class UpdateIntent(StrictModel):
    kind: Literal['update']
    taskId: Text
    objective: Text
    reason: Text
    allowedFields: list[PlanField] = Field(min_length=1, max_length=4)
    durationDirection: Literal['reduce', 'preserve', 'adjust']
    estimatedMinutes: StrictInt | None = Field(default=None, gt=0)
    plannedDate: str | None = None
    title: Text | None = None
    description: str | None = None

    @model_validator(mode='after')
    def valid_constraints(self):
        if len(set(self.allowedFields)) != len(self.allowedFields):
            raise ValueError('调整字段不能重复')
        for name in ('estimatedMinutes', 'plannedDate', 'title', 'description'):
            if getattr(self, name) is not None and name not in self.allowedFields:
                raise ValueError('精确约束必须属于允许调整的字段')
        if self.durationDirection == 'reduce' and 'estimatedMinutes' not in self.allowedFields:
            raise ValueError('缩短时长必须允许调整 estimatedMinutes')
        CreateTaskArguments.valid_date(self.plannedDate)
        return self


class CreateIntent(StrictModel):
    kind: Literal['create']
    title: Text
    category: Category
    objective: Text
    reason: Text
    weeklyGoalId: Text | None = None
    estimatedMinutes: StrictInt | None = Field(default=None, gt=0)
    plannedDate: str | None = None

    @model_validator(mode='after')
    def valid_date(self):
        CreateTaskArguments.valid_date(self.plannedDate)
        return self


class ReplanPlannerDraft(StrictModel):
    summary: Text
    diagnosis: list[ReflectionFact] = Field(max_length=3)
    strategy: list[ReplanStrategy] = Field(max_length=3)
    adjustmentIntents: list[Annotated[UpdateIntent | CreateIntent, Field(discriminator='kind')]] = Field(max_length=3)


class GeneratedAction(StrictModel):
    intentIndex: StrictInt = Field(ge=0)
    action: Annotated[CreateReplanAction | UpdateReplanAction, Field(discriminator='toolName')]


class ReplanActionBatch(StrictModel):
    actions: list[GeneratedAction] = Field(max_length=3)
