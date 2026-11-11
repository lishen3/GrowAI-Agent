from typing import Annotated, Literal
from pydantic import Field, StrictInt
from app.models.actions import ActionDraft, AgentAction, CreateTaskArguments, UpdateTaskArguments
from app.models.context import StrictModel
from app.models.reflection import ReflectionFact, Text


class ReplanStrategy(StrictModel):
    statement: Text
    reason: Text
    basedOnMemoryIds: list[Text] = Field(max_length=20)


class CreateReplanAction(StrictModel):
    toolName: Literal['create_task']
    arguments: CreateTaskArguments
    reason: Text


class UpdateReplanAction(StrictModel):
    toolName: Literal['update_task']
    arguments: UpdateTaskArguments
    reason: Text


class WeeklyReplanDraft(StrictModel):
    summary: Text
    diagnosis: list[ReflectionFact] = Field(max_length=20)
    strategy: list[ReplanStrategy] = Field(max_length=20)
    actions: list[Annotated[CreateReplanAction | UpdateReplanAction, Field(discriminator='toolName')]] = Field(max_length=10)

    def action_drafts(self) -> list[ActionDraft]:
        return [ActionDraft(toolName=item.toolName,
                            arguments=item.arguments.model_dump(exclude_none=True), reason=item.reason)
                for item in self.actions]


class ReplanImpact(StrictModel):
    beforePlannedMinutes: StrictInt | None = Field(ge=0)
    afterPlannedMinutes: StrictInt | None = Field(ge=0)
    affectedTaskCount: StrictInt = Field(ge=0)


class WeeklyReplanProposal(StrictModel):
    summary: Text
    diagnosis: list[ReflectionFact]
    strategy: list[ReplanStrategy]
    expectedChanges: ReplanImpact
    actions: list[AgentAction]
