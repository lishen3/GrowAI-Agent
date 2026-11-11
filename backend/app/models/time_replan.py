from datetime import date
from typing import Literal

from pydantic import AwareDatetime, Field, field_validator, model_validator

from app.models.context import AgentContext, StrictModel
from app.models.reflection import Text

_TIME_PATTERN = r'^([01]\d|2[0-3]):[0-5]\d$'


class TimeSlot(StrictModel):
    date: str
    startTime: Text
    endTime: Text

    @field_validator('date')
    @classmethod
    def valid_date(cls, value: str) -> str:
        if date.fromisoformat(value).isoformat() != value:
            raise ValueError('日期必须为 YYYY-MM-DD')
        return value

    @field_validator('startTime', 'endTime')
    @classmethod
    def valid_time(cls, value: str) -> str:
        import re
        if not re.match(_TIME_PATTERN, value):
            raise ValueError('时间必须为 HH:mm')
        return value

    @model_validator(mode='after')
    def valid_range(self):
        if self.startTime >= self.endTime:
            raise ValueError('结束时间必须晚于开始时间，不支持跨日')
        return self


class TimeReplanRequest(StrictModel):
    context: AgentContext
    eventId: Text
    duration_minutes: int | None = Field(default=None, strict=True, ge=1, le=240)
    runtime_date: str
    user_message: Text = Field(min_length=1, max_length=2000)

    @field_validator('runtime_date')
    @classmethod
    def valid_runtime_date(cls, value: str) -> str:
        if date.fromisoformat(value).isoformat() != value:
            raise ValueError('runtime_date 必须为 YYYY-MM-DD')
        return value

    @field_validator('user_message')
    @classmethod
    def nonblank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError('需求不能为空')
        return value


class TimeScheduleRequest(StrictModel):
    duration_minutes: int | None = Field(default=None, strict=True, ge=1, le=240)
    context: AgentContext
    taskId: Text
    runtime_date: str
    user_message: Text = Field(min_length=1, max_length=2000)

    @field_validator('runtime_date')
    @classmethod
    def valid_runtime_date(cls, value: str) -> str:
        if date.fromisoformat(value).isoformat() != value:
            raise ValueError('runtime_date 必须为 YYYY-MM-DD')
        return value

    @field_validator('user_message')
    @classmethod
    def nonblank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError('需求不能为空')
        return value


class TimeMoveDraft(StrictModel):
    """The only thing the model is allowed to choose: a target slot and a reason."""

    date: str
    startTime: Text
    endTime: Text
    reason: Text

    @field_validator('date')
    @classmethod
    def valid_date(cls, value: str) -> str:
        if date.fromisoformat(value).isoformat() != value:
            raise ValueError('日期必须为 YYYY-MM-DD')
        return value

    @field_validator('startTime', 'endTime')
    @classmethod
    def valid_time(cls, value: str) -> str:
        import re
        if not re.match(_TIME_PATTERN, value):
            raise ValueError('时间必须为 HH:mm')
        return value

    @model_validator(mode='after')
    def valid_range(self):
        if self.startTime >= self.endTime:
            raise ValueError('结束时间必须晚于开始时间')
        return self


class TimeMoveProposal(StrictModel):
    proposalId: Text
    eventId: Text
    taskId: Text
    before: TimeSlot
    after: TimeSlot
    reason: Text
    candidates: list[TimeSlot] = Field(max_length=200)
    createdAt: AwareDatetime
    expiresAt: AwareDatetime

    @model_validator(mode='after')
    def valid_move(self):
        if self.before.date == self.after.date and self.before == self.after:
            raise ValueError('目标时间块与原时间块相同')
        if not self.createdAt < self.expiresAt:
            raise ValueError('提案过期时间必须晚于创建时间')
        return self


class TimeScheduleProposal(StrictModel):
    proposalId: Text
    taskId: Text
    after: TimeSlot
    reason: Text
    candidates: list[TimeSlot] = Field(max_length=200)
    createdAt: AwareDatetime
    expiresAt: AwareDatetime

    @model_validator(mode='after')
    def valid_schedule(self):
        if not self.createdAt < self.expiresAt:
            raise ValueError('提案过期时间必须晚于创建时间')
        return self


class CreateAndScheduleRequest(StrictModel):
    context: AgentContext
    runtime_date: str
    user_message: Text = Field(min_length=1, max_length=2000)

    @field_validator('runtime_date')
    @classmethod
    def valid_runtime_date(cls, value: str) -> str:
        if date.fromisoformat(value).isoformat() != value:
            raise ValueError('runtime_date 必须为 YYYY-MM-DD')
        return value

    @field_validator('user_message')
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('需求不能为空')
        return value.strip()


class CreateAndScheduleDraft(TimeSlot):
    action: Literal['CREATE_AND_SCHEDULE']
    taskTitle: Text = Field(min_length=1, max_length=200)
    reason: Text = Field(max_length=4000)

    @field_validator('taskTitle', 'reason')
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('标题与理由不能为空')
        return value.strip()


class CreateAndScheduleProposal(CreateAndScheduleDraft):
    proposalId: Text
    createdAt: AwareDatetime
    expiresAt: AwareDatetime

    @model_validator(mode='after')
    def valid_lifetime(self):
        if self.createdAt >= self.expiresAt:
            raise ValueError('提案过期时间无效')
        return self
