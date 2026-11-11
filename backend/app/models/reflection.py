from typing import Annotated, Literal
from pydantic import Field, StringConstraints, StrictBool, StrictFloat, StrictInt, StrictStr
from app.models.context import StrictModel

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
Confidence = Literal['LOW', 'MEDIUM', 'HIGH']
MemoryType = Literal['PREFERENCE', 'PATTERN', 'STRATEGY', 'CONSTRAINT', 'LESSON']


class EvidenceReference(StrictModel):
    source: Literal['LONG_TERM_GOAL', 'PERIOD_GOAL', 'WEEKLY_GOAL', 'TASK', 'EXECUTION', 'ACHIEVEMENT', 'STAT']
    id: str = Field(min_length=1, max_length=200)
    field: str = Field(min_length=1, max_length=100)
    value: Annotated[StrictStr, Field(max_length=4000)] | StrictInt | Annotated[StrictFloat, Field(allow_inf_nan=False)] | StrictBool | None


References = Annotated[list[EvidenceReference], Field(min_length=1, max_length=20)]


class ReflectionFact(StrictModel):
    statement: Text
    evidence: Text
    references: References | None = Field(default=None, exclude_if=lambda value: value is None)


class ReflectionInsight(ReflectionFact):
    confidence: Confidence


class MemoryCandidate(StrictModel):
    type: MemoryType
    content: Text
    evidence: Text
    confidence: Confidence
    references: References | None = Field(default=None, exclude_if=lambda value: value is None)


class GrowthAction(StrictModel):
    taskId: str = Field(min_length=1)
    relationship: Literal['DIRECT', 'INFERRED']
    claim: Literal['PLANNED', 'COMPLETED']
    explanation: Text
    references: References


class GoalAnalysis(StrictModel):
    goalId: str = Field(min_length=1)
    progress: Literal['EVIDENCED', 'PARTIAL', 'RISK', 'INSUFFICIENT']
    confidence: Confidence
    explanation: Text
    actions: list[GrowthAction] = Field(max_length=30)
    references: References
    gaps: list[Text] = Field(max_length=10)


class NextWeekSuggestion(StrictModel):
    content: Text
    purpose: Text
    priority: Literal['S', 'A', 'B', 'C']
    suggestedMinutes: StrictInt | None = Field(ge=1, le=10080)
    references: References


class GrowthAnalysis(StrictModel):
    version: Literal[1]
    goalAnalyses: list[GoalAnalysis] = Field(max_length=30)
    nextWeekSuggestions: list[NextWeekSuggestion] = Field(max_length=20)
    dataGaps: list[Text] = Field(max_length=20)


class WeeklyReflectionDraft(StrictModel):
    summary: Text
    facts: list[ReflectionFact] = Field(max_length=30)
    insights: list[ReflectionInsight] = Field(max_length=20)
    memoryCandidates: list[MemoryCandidate] = Field(max_length=10)
    # Legacy reading only; the generation boundary rejects absent growth/evidence.
    growth: GrowthAnalysis | None = Field(default=None, exclude_if=lambda value: value is None)


# Generation is stricter than reading historical records. Never relax evidence
# validation to accommodate a model that returns the legacy shape.
class GeneratedReflectionFact(ReflectionFact):
    references: References


class GeneratedReflectionInsight(ReflectionInsight):
    references: References


class GeneratedMemoryCandidate(MemoryCandidate):
    references: References


class GeneratedWeeklyReflectionDraft(WeeklyReflectionDraft):
    facts: list[GeneratedReflectionFact] = Field(max_length=30)
    insights: list[GeneratedReflectionInsight] = Field(max_length=20)
    memoryCandidates: list[GeneratedMemoryCandidate] = Field(max_length=10)
    growth: GrowthAnalysis
