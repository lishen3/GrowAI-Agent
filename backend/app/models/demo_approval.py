from pydantic import Field, StrictBool, StrictInt

from app.models.context import StrictModel
from app.models.planning_preview import PlanningPreviewRequest
from app.models.replan_approval import ApprovedChangeSet, ApprovalScope


class SubmitDemoApproval(StrictModel):
    preview_id: str = Field(min_length=1)
    action_index: StrictInt = Field(ge=0, le=2)
    facts: PlanningPreviewRequest


class DecideDemoApproval(StrictModel):
    userDecision: StrictBool
    confirmedContent: dict
    facts: PlanningPreviewRequest


class PrepareDemoExecution(StrictModel):
    changeSet: ApprovedChangeSet
    facts: PlanningPreviewRequest


class DemoExecutionValidation(StrictModel):
    scope: ApprovalScope
    periodStart: str
    periodEnd: str
    valid: StrictBool
