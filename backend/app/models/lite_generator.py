from datetime import date
from typing import Annotated, Literal

from pydantic import Field, StrictStr, StringConstraints, field_validator

from app.models.context import StrictModel
from app.models.reflection import Text


class DateOnlyChanges(StrictModel):
    plannedDate: StrictStr

    @field_validator('plannedDate')
    @classmethod
    def valid_date(cls, value: str) -> str:
        if date.fromisoformat(value).isoformat() != value:
            raise ValueError('plannedDate must be YYYY-MM-DD')
        return value


class DateOnlyUpdateArguments(StrictModel):
    taskId: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1)]
    changes: DateOnlyChanges


class DateOnlyUpdateAction(StrictModel):
    toolName: Literal['update_task']
    arguments: DateOnlyUpdateArguments
    reason: Text


class LiteGeneratorDraft(StrictModel):
    actions: list[DateOnlyUpdateAction] = Field(max_length=3)
