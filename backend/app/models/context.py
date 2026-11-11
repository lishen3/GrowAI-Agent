from typing import Literal
from datetime import date

from pydantic import BaseModel, ConfigDict, Field, model_validator, model_serializer

Category = Literal[
    "ENGLISH", "PROFESSIONAL", "CAREER", "PROJECT", "FITNESS",
    "COURSE", "LIFE", "CUSTOM", "INTERNSHIP", "REVIEW",
]
Priority = Literal["S", "A", "B", "C"]
PlanningStatus = Literal["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_serializer(mode="wrap")
    def optional_category_fields(self, handler):
        value = handler(self)
        for key in ("categoryId", "categories", "planning", "progress"):
            if key not in self.model_fields_set:
                value.pop(key, None)
        return value


class JourneyFact(StrictModel):
    id: str
    name: str
    startedAt: str


class PeriodFact(StrictModel):
    id: str
    name: str
    type: Literal["SEMESTER", "WINTER_BREAK", "SUMMER_BREAK", "INTERNSHIP", "EXAM", "JOB_SEARCH", "CUSTOM"]
    status: Literal["PLANNED", "ACTIVE", "COMPLETED"]
    startDate: str
    endDate: str


class CurrentWeekFact(StrictModel):
    index: int
    windowStart: str
    windowEnd: str


class GoalMilestoneFact(StrictModel):
    id: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=1000)
    weight: float = Field(gt=0, le=1000000, allow_inf_nan=False)
    completed: bool


class GoalPlanningFact(StrictModel):
    endDate: str | None
    mode: Literal['MANUAL', 'MILESTONE']
    manualPercent: float = Field(ge=0, le=100, allow_inf_nan=False)
    milestones: list[GoalMilestoneFact] = Field(max_length=100)

    @model_validator(mode='after')
    def validate_planning(self):
        if self.endDate is not None:
            parsed = date.fromisoformat(self.endDate)
            if parsed.isoformat() != self.endDate:
                raise ValueError('Invalid goal date')
        if len({m.id for m in self.milestones}) != len(self.milestones):
            raise ValueError('Duplicate milestone')
        return self


class GoalProgressFact(StrictModel):
    percent: float = Field(ge=0, le=100, allow_inf_nan=False)
    source: str = Field(min_length=1, max_length=100)


class LongTermGoalFact(StrictModel):
    id: str
    title: str
    category: Category
    status: Literal["PLANNED", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"]
    targetDescription: str
    planning: GoalPlanningFact | None = None
    progress: GoalProgressFact | None = None

    @model_validator(mode='after')
    def verify_progress(self):
        if self.progress is not None:
            if self.planning is None:
                raise ValueError('Progress requires planning facts')
            p = self.planning
            total = sum(m.weight for m in p.milestones)
            expected = p.manualPercent if p.mode == 'MANUAL' else sum(m.weight for m in p.milestones if m.completed) / total * 100 if total else None
            source = '用户手动评估' if p.mode == 'MANUAL' else '已完成里程碑权重 / 总权重'
            if expected is None or abs(self.progress.percent - expected) > 0.000001 or self.progress.source != source:
                raise ValueError('Goal progress does not match its explicit source')
        return self


class PeriodGoalFact(StrictModel):
    id: str
    longTermGoalId: str | None
    title: str
    category: Category
    priority: Priority
    status: PlanningStatus
    successCriteria: list[str]


class WeeklyGoalFact(StrictModel):
    id: str
    periodGoalId: str
    title: str
    category: Category
    priority: Priority
    status: PlanningStatus
    targetValue: float | None
    targetUnit: str | None


class TaskFact(StrictModel):
    categoryId: str | None = Field(default=None, min_length=1, max_length=128)
    id: str
    title: str
    category: Category
    priority: Priority
    status: Literal["TODO", "DOING", "DONE", "DELAYED", "CANCELLED"]
    plannedDate: str
    estimatedMinutes: int | None
    weeklyGoalId: str | None
    periodGoalId: str | None = None

    @model_serializer(mode="wrap")
    def preserve_optional_goal_reference(self, handler):
        value = handler(self)
        for key in ("periodGoalId", "categoryId"):
            if key not in self.model_fields_set:
                value.pop(key, None)
        return value


class ReviewTaskFact(TaskFact):
    plannedDate: str | None


class ReflectionTaskFact(ReviewTaskFact):
    periodId: str


class ReflectionHistoryFact(StrictModel):
    id: str
    periodId: str
    startDate: str
    endDate: str
    summary: str = Field(max_length=1000)


class ReflectionWindowFact(StrictModel):
    startAt: str
    endExclusiveAt: str


class ReflectionTotalsFact(StrictModel):
    executionCount: int = Field(ge=0)
    actualMinutes: int | None = Field(ge=0)
    unknownMinutesCount: int = Field(ge=0)
    executionsTruncated: bool
    achievementsTruncated: bool


class ExecutionFact(StrictModel):
    id: str
    taskId: str
    completedAt: str
    plannedMinutesSnapshot: int | None
    actualMinutes: int | None
    completionNote: str | None
    result: str | None
    learned: str | None


class AchievementFact(StrictModel):
    categoryId: str | None = Field(default=None, min_length=1, max_length=128)
    id: str
    sourceId: str
    title: str
    category: Category
    occurredAt: str
    plannedDurationSnapshot: int | None
    actualDuration: int | None
    summary: str | None
    result: str | None
    isMilestone: bool


class CategoryBreakdown(StrictModel):
    categoryId: str | None = Field(default=None, min_length=1, max_length=128)
    category: Category
    plannedTaskCount: int
    completedTaskCount: int
    plannedMinutes: int | None
    actualMinutes: int | None


class PlanVsReality(StrictModel):
    plannedTaskCount: int
    completedTaskCount: int
    unfinishedTaskCount: int
    cancelledTaskCount: int
    plannedMinutes: int | None
    actualMinutes: int | None
    completionRate: float | None
    categoryBreakdown: list[CategoryBreakdown]
    unfinishedTasks: list[ReviewTaskFact]
    completedTasks: list[ReviewTaskFact]


class ReviewFacts(StrictModel):
    windowStart: str
    windowEnd: str
    plannedTaskCount: int
    completedTaskCount: int
    unfinishedTaskCount: int
    cancelledTaskCount: int
    plannedMinutes: int | None
    actualMinutes: int | None
    achievementCount: int
    categoryBreakdown: list[CategoryBreakdown]


class MemoryFact(StrictModel):
    id: str
    journeyId: str
    type: Literal['PREFERENCE', 'PATTERN', 'STRATEGY', 'CONSTRAINT', 'LESSON']
    content: str = Field(min_length=1, max_length=4000)
    evidence: str = Field(min_length=1, max_length=4000)
    confidence: Literal['LOW', 'MEDIUM', 'HIGH']
    sourceType: Literal['REFLECTION', 'USER']
    sourceId: str | None
    status: Literal['ACTIVE']
    createdAt: str
    updatedAt: str


class SchedulingTaskEventFact(StrictModel):
    categoryId: str | None = Field(default=None, min_length=1, max_length=128)
    kind: Literal['TASK']
    eventId: str
    taskId: str
    title: str
    date: str
    startTime: str
    endTime: str
    adjustable: bool


class SchedulingCourseEventFact(StrictModel):
    categoryId: str | None = Field(default=None, min_length=1, max_length=128)
    kind: Literal['COURSE']
    eventId: str
    courseId: str | None
    title: str
    date: str
    startTime: str
    endTime: str
    locked: Literal[True]


class SchedulingAdjustmentEventFact(StrictModel):
    categoryId: str | None = Field(default=None, min_length=1, max_length=128)
    kind: Literal['AI_ADJUSTMENT']
    eventId: str
    taskId: str
    title: str
    date: str
    startTime: str
    endTime: str
    locked: Literal[True]


class SchedulingPersonalEventFact(StrictModel):
    categoryId: str | None = Field(default=None, min_length=1, max_length=128)
    kind: Literal['PERSONAL']
    eventId: str
    taskId: Literal[None]
    title: str
    date: str
    startTime: str
    endTime: str
    locked: Literal[True]


SchedulingEventFact = (SchedulingTaskEventFact | SchedulingCourseEventFact
                       | SchedulingAdjustmentEventFact | SchedulingPersonalEventFact)


class ScheduleConflictFact(StrictModel):
    eventAId: str
    eventBId: str
    type: Literal['OVERLAP']
    severity: Literal['WARNING']


class UnscheduledTaskFact(StrictModel):
    periodGoalId: str | None = Field(default=None, exclude_if=lambda value: value is None)
    weeklyGoalId: str | None = Field(default=None, exclude_if=lambda value: value is None)
    priority: Priority | None = Field(default=None, exclude_if=lambda value: value is None)
    categoryId: str | None = Field(default=None, min_length=1, max_length=128)
    id: str
    title: str
    status: Literal['TODO', 'DOING', 'DONE', 'DELAYED', 'CANCELLED']
    plannedDate: str | None
    estimatedMinutes: int | None


class LinkedSchedulingTaskFact(UnscheduledTaskFact):
    periodId: str


class SchedulingContext(StrictModel):
    weekStart: str
    weekEnd: str
    events: list[SchedulingEventFact]
    conflicts: list[ScheduleConflictFact]
    unscheduledTasks: list[UnscheduledTaskFact]
    linkedTaskFacts: list[LinkedSchedulingTaskFact] | None = Field(default=None, exclude_if=lambda value: value is None)


class ActionCategoryFact(StrictModel):
    id: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_-]{0,127}$")
    journeyId: str
    name: str = Field(min_length=1, max_length=80)
    normalizedName: str
    system: bool
    status: Literal['ACTIVE', 'ARCHIVED']
    sortOrder: int = Field(ge=0)
    createdAt: str | None
    updatedAt: str | None


class TimeWindowFact(StrictModel):
    startDate: str
    endDate: str


class AgentContext(StrictModel):
    timeWindow: TimeWindowFact | None = Field(default=None, exclude_if=lambda value: value is None)
    reflectionTasks: list[ReflectionTaskFact] | None = Field(default=None, exclude_if=lambda value: value is None)
    reflectionTimeZone: str | None = Field(default=None, exclude_if=lambda value: value is None)
    reflectionWindow: ReflectionWindowFact | None = Field(default=None, exclude_if=lambda value: value is None)
    reflectionTotals: ReflectionTotalsFact | None = Field(default=None, exclude_if=lambda value: value is None)
    reflectionHistory: list[ReflectionHistoryFact] | None = Field(default=None, max_length=4, exclude_if=lambda value: value is None)
    categories: list[ActionCategoryFact] | None = Field(default=None, max_length=1000)

    @model_validator(mode='after')
    def category_scope(self):
        if self.categories is not None:
            ids = [row.id for row in self.categories]
            if len(ids) != len(set(ids)) or any(row.journeyId != self.journey.id for row in self.categories):
                raise ValueError('Invalid category registry scope')
            facts = [*self.tasks, *self.planVsReality.completedTasks, *self.planVsReality.unfinishedTasks,
                     *self.recentAchievements, *self.planVsReality.categoryBreakdown, *self.reviewFacts.categoryBreakdown]
            facts.extend(self.reflectionTasks or [])
            if self.schedule:
                facts.extend(self.schedule.events)
                facts.extend(self.schedule.unscheduledTasks)
                facts.extend(self.schedule.linkedTaskFacts or [])
            if any(row.categoryId and row.categoryId not in ids for row in facts):
                raise ValueError('Unregistered category fact')
        elif any(row.categoryId for row in [*self.tasks, *self.planVsReality.completedTasks, *self.planVsReality.unfinishedTasks, *self.recentAchievements, *(self.reflectionTasks or [])]):
            raise ValueError('Category registry required')
        return self

    generatedAt: str
    journey: JourneyFact
    currentPeriod: PeriodFact
    currentWeek: CurrentWeekFact
    longTermGoals: list[LongTermGoalFact]
    periodGoals: list[PeriodGoalFact]
    weeklyGoals: list[WeeklyGoalFact]
    tasks: list[TaskFact]
    recentExecutions: list[ExecutionFact]
    recentAchievements: list[AchievementFact]
    planVsReality: PlanVsReality
    reviewFacts: ReviewFacts
    # Older clients may omit memories; current-week fact names stay compatible.
    memories: list[MemoryFact] = Field(default_factory=list, max_length=20)
    # Optional for compatibility with clients that have not shipped scheduling read models.
    schedule: SchedulingContext | None = Field(default=None, exclude_if=lambda value: value is None)

    @model_validator(mode='after')
    def context_scope_matches(self):
        if self.reflectionTasks is not None:
            if len({task.id for task in self.reflectionTasks}) != len(self.reflectionTasks) or any(
                task.periodId != self.currentPeriod.id for task in self.reflectionTasks
            ):
                raise ValueError('Invalid reflection task scope')
        if self.reflectionHistory is not None and any(
            row.startDate > row.endDate or row.endDate >= self.currentWeek.windowStart for row in self.reflectionHistory
        ):
            raise ValueError('Invalid reflection history window')
        if any(memory.journeyId != self.journey.id for memory in self.memories):
            raise ValueError('Memory must belong to the current journey')
        if self.schedule is not None:
            window_start = self.timeWindow.startDate if self.timeWindow else self.currentWeek.windowStart
            window_end = self.timeWindow.endDate if self.timeWindow else self.currentWeek.windowEnd
            if self.timeWindow and (not 0 <= (date.fromisoformat(window_end) - date.fromisoformat(window_start)).days <= 13
                    or not self.currentPeriod.startDate <= window_start <= window_end <= self.currentPeriod.endDate):
                raise ValueError('Invalid time scheduling horizon')
            linked = self.schedule.linkedTaskFacts
            if linked is not None:
                if len({task.id for task in linked}) != len(linked) or any(
                    task.periodId != self.currentPeriod.id or not any(
                        event.kind in ('TASK', 'AI_ADJUSTMENT') and event.taskId == task.id for event in self.schedule.events)
                    for task in linked
                ):
                    raise ValueError('Invalid linked scheduling task scope or association')
            if (self.schedule.weekStart != window_start
                    or self.schedule.weekEnd != window_end):
                raise ValueError('SchedulingContext window must match currentWeek')
            if any(not self.schedule.weekStart <= event.date <= self.schedule.weekEnd
                   for event in self.schedule.events):
                raise ValueError('Scheduling event must belong to SchedulingContext window')
            # A current-period task may be scheduled into a different week without changing plannedDate.
        return self


class WeeklyAnalysisRequest(StrictModel):
    context: AgentContext
    user_message: str | None = Field(default=None, max_length=2000)
