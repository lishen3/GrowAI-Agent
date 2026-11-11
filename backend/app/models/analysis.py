from typing import Literal

from pydantic import Field

from .context import Category, StrictModel


class Observation(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    evidence: str = Field(min_length=1, max_length=1000)
    category: Category | Literal["GENERAL"]


class Risk(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    reason: str = Field(min_length=1, max_length=1000)


class Suggestion(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    reason: str = Field(min_length=1, max_length=1000)
    priority: Literal["HIGH", "MEDIUM", "LOW"]


class WeeklyAnalysisResult(StrictModel):
    summary: str = Field(min_length=1, max_length=2000)
    observations: list[Observation] = Field(max_length=12)
    risks: list[Risk] = Field(max_length=12)
    suggestions: list[Suggestion] = Field(max_length=12)
    data_gaps: list[str] = Field(max_length=12)
