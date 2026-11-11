from pydantic import Field, StrictInt, model_validator

from app.models.context import AgentContext, StrictModel
from app.models.lite_generator import DateOnlyChanges, LiteGeneratorDraft
from app.models.planner_lite import PlannerLiteDraft
from app.models.replan_approval import PolicyCheck, TaskSnapshot


class PlanningPreviewRequest(StrictModel):
    context: AgentContext
    user_message: str = Field(min_length=1, max_length=2000)
    runtime_date: str
    allowed_dates: list[str] = Field(min_length=1, max_length=7)
    task_facts: list[TaskSnapshot]
    session_id: str | None = Field(default=None, min_length=1, max_length=120)
    reset_epoch: StrictInt | None = Field(default=None, ge=0)

    @model_validator(mode='after')
    def verify_demo_facts(self):
        if (self.session_id is None) != (self.reset_epoch is None):
            raise ValueError('Session and epoch must be supplied together')
        if self.context.journey.id != 'demo_journey' or self.context.currentPeriod.id != 'demo_period':
            raise ValueError('Only the isolated demo snapshot is accepted')
        DateOnlyChanges(plannedDate=self.runtime_date)
        for value in self.allowed_dates:
            DateOnlyChanges(plannedDate=value)
            if not max(self.runtime_date, self.context.currentWeek.windowStart, self.context.currentPeriod.startDate) <= value <= min(self.context.currentWeek.windowEnd, self.context.currentPeriod.endDate):
                raise ValueError('Allowed date is outside the current window')
        if len(set(self.allowed_dates)) != len(self.allowed_dates):
            raise ValueError('Duplicate allowed dates')
        facts = {task.id: task for task in self.task_facts}
        if len(facts) != len(self.task_facts) or set(facts) != {task.id for task in self.context.tasks}:
            raise ValueError('Full task facts must match the context task set')
        for task in self.context.tasks:
            source = facts[task.id]
            if source.periodId != self.context.currentPeriod.id or any(source.model_dump()[key] != value for key, value in task.model_dump().items()):
                raise ValueError('Task facts differ from the context')
        return self


class CandidatePreview(StrictModel):
    candidateTaskIds: list[str]
    allowedTargetDates: dict[str, list[str]]
    rejectedReasons: dict[str, str]


class PlanningPreviewResult(StrictModel):
    previewId: str | None = None
    planner: PlannerLiteDraft
    candidates: CandidatePreview
    draft: LiteGeneratorDraft
    policyChecks: list[PolicyCheck]
