from datetime import date
from typing import Literal

from pydantic import Field, StrictBool, StrictInt, field_validator, model_validator

from app.models.context import AgentContext, Category, StrictModel


class CreateTaskArguments(StrictModel):
    title: str = Field(min_length=1)
    category: Category
    categoryId: str | None = Field(default=None, pattern=r'^[A-Za-z][A-Za-z0-9_-]{0,127}$')
    description: str | None = None
    plannedDate: str | None = None
    estimatedMinutes: StrictInt | None = Field(default=None, ge=0)
    weeklyGoalId: str | None = Field(default=None, min_length=1)

    @field_validator('title')
    @classmethod
    def nonblank_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('title must not be blank')
        return value.strip()

    @field_validator('plannedDate')
    @classmethod
    def valid_date(cls, value: str | None) -> str | None:
        if value is not None and date.fromisoformat(value).isoformat() != value:
            raise ValueError('plannedDate must be YYYY-MM-DD')
        return value


class TaskChanges(StrictModel):
    categoryId: str | None = Field(default=None, pattern=r'^[A-Za-z][A-Za-z0-9_-]{0,127}$')
    title: str | None = None
    estimatedMinutes: StrictInt | None = Field(default=None, ge=0)
    plannedDate: str | None = None
    description: str | None = None

    @model_validator(mode='after')
    def valid_changes(self):
        if not self.model_fields_set or any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError('changes must contain non-null planning fields')
        if self.title is not None:
            self.title = CreateTaskArguments.nonblank_title(self.title)
        CreateTaskArguments.valid_date(self.plannedDate)
        return self


class UpdateTaskArguments(StrictModel):
    taskId: str = Field(min_length=1)
    changes: TaskChanges


class ActionDraft(StrictModel):
    toolName: str
    arguments: dict
    reason: str = Field(min_length=1)

    @field_validator('reason')
    @classmethod
    def nonblank_reason(cls, value: str) -> str:
        return CreateTaskArguments.nonblank_title(value)


class ProposalDraft(StrictModel):
    message: str = Field(min_length=1)
    actions: list[ActionDraft] = Field(max_length=10)

    @field_validator('message')
    @classmethod
    def nonblank_message(cls, value: str) -> str:
        return CreateTaskArguments.nonblank_title(value)


class AgentAction(ActionDraft):
    id: str
    requiresConfirmation: Literal[True] = True


class AgentActionProposal(StrictModel):
    message: str
    actions: list[AgentAction]


class ProposeRequest(StrictModel):
    context: AgentContext
    user_message: str = Field(min_length=1, max_length=2000)

    @field_validator('user_message')
    @classmethod
    def nonblank_message(cls, value: str) -> str:
        return CreateTaskArguments.nonblank_title(value)


class ExecuteRequest(StrictModel):
    actionId: str
    approval: StrictBool


class ActionAuthorization(StrictModel):
    actionId: str
    status: Literal['APPROVED', 'REJECTED']
    periodId: str
    action: AgentAction
