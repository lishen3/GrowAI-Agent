from copy import deepcopy
import re
import time
from app.services.performance import emit
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from app.models.context import AgentContext, SchedulingTaskEventFact
from app.models.time_replan import TimeMoveDraft, TimeMoveProposal, TimeScheduleProposal, TimeSlot, CreateAndScheduleDraft, CreateAndScheduleProposal
from app.services.time_replan_prompt import build_schedule_task_prompt, build_time_replan_prompt, build_create_and_schedule_prompt

GRID_MINUTES = 30
DAY_START_MINUTES = 8 * 60
DAY_END_MINUTES = 22 * 60
MAX_CANDIDATES = 200
USER_TIMEZONE = timezone(timedelta(hours=8))


def current_time() -> datetime:
    return datetime.now(timezone.utc)


def _minutes(value: str) -> int:
    return int(value[:2]) * 60 + int(value[3:])


def _time(value: int) -> str:
    return f'{value // 60:02d}:{value % 60:02d}'


def _overlaps(start: int, end: int, other_start: int, other_end: int) -> bool:
    return start < other_end and other_start < end


def _relative_candidates(candidates: list[TimeSlot], runtime_date: str, message: str) -> list[TimeSlot]:
    def bounded(rows):
        if len(rows) <= MAX_CANDIDATES:
            return rows
        # Preserve coverage of the whole horizon when no single date was requested.
        return [rows[round(i * (len(rows) - 1) / (MAX_CANDIDATES - 1))] for i in range(MAX_CANDIDATES)]
    # Narrow deterministic support, not a general natural-language date parser.
    days = {'今天': 0, '明天': 1, '后天': 2}
    absolute = set(re.findall(r'(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)', message))
    if absolute:
        if len(absolute) != 1 or re.search(r'今天|明天|后天|下(?:个)?(?:周|星期|礼拜)|不行|不要|不能|避开|之前|之后|以后|以前|或', message):
            raise ValueError('请明确一个目标日期，不支持多个日期或排除条件')
        target = date.fromisoformat(next(iter(absolute))).isoformat()
        return bounded([slot for slot in candidates if slot.date == target])
    if re.search(r'过几天|几天后', message):
        raise ValueError('请明确一个目标日期，当前不支持模糊日期或下周表达')
    next_week = re.findall(r'下(?:个)?(?:周|星期|礼拜)([一二三四五六日天])?', message)
    if next_week:
        if len(next_week) != 1 or re.search(r'今天|明天|后天|不行|不要|不能|避开|之前|之后|以后|以前|或', message):
            raise ValueError('请明确一个目标日期，不支持多个日期或排除条件')
        today = date.fromisoformat(runtime_date)
        monday = today + timedelta(days=7 - today.weekday())
        weekday = next_week[0]
        start = monday + timedelta(days=min('一二三四五六日天'.index(weekday), 6)) if weekday else monday
        end = start if weekday else monday + timedelta(days=6)
        return bounded([slot for slot in candidates if start.isoformat() <= slot.date <= end.isoformat()])
    if '大后天' in message:
        raise ValueError('请明确一个绝对目标日期，当前相对日期支持今天、明天、后天')
    mentioned = set(re.findall(r'今天|明天|(?<!大)后天', message))
    if not mentioned:
        part = re.fullmatch(r'\s*(上午|早上|中午|下午|晚上)[。！!]*\s*', message)
        if part:
            start, end = {'上午': ('08:00', '12:00'), '早上': ('08:00', '12:00'),
                          '中午': ('12:00', '14:00'), '下午': ('12:00', '18:00'),
                          '晚上': ('18:00', '22:00')}[part.group(1)]
            return bounded([slot for slot in candidates if start <= slot.startTime and slot.endTime <= end])
        return bounded(candidates)
    if len(mentioned) != 1 or re.search(
            r'(?:不要|不能|不想|不在|别|避开|排除|除了|除去)\s*(?:在)?(?:今天|明天|后天)'
            r'|(?:今天|明天|后天)\s*(?:不|没)', message):
        raise ValueError('相对日期包含多个选项或排除条件，请明确一个目标日期')
    day = next(iter(mentioned))
    explicit_target = re.search(r'(?:安排(?:到|在)?|排到|挪到|移到|改到|放到|优先|尽量|最好)\s*' + day, message)
    last_clause = re.split(r'[，,；;]', message)[-1].strip()
    short_target = re.fullmatch(day + r'(?:上午|下午|晚上|早上|中午)(?:安排)?[。！!]*', last_clause)
    initial_target = re.match(r'^\s*' + day + r'(?:上午|下午|晚上|早上|中午)?\s*'
                              r'(?:(?:[01]?\d|2[0-3]|[一二三四五六七八九十两]{1,3})'
                              r'(?:点(?:半|[0-5]?\d分?)?|:[0-5]\d)\s*)?'
                              r'(?:请|帮我)?(?:安排|新建|创建)', message)
    clock = r'(?:[01]?\d|2[0-3]|[一二三四五六七八九十两]{1,3})(?:点(?:半|[0-5]?\d分?)?|:[0-5]\d)'
    timed_action = re.fullmatch(r'\s*' + day + r'(?:上午|下午|晚上|早上|中午)?\s*' + clock
                               + r'(?:\s*(?:到|至|[-–])\s*(?:上午|下午|晚上|早上|中午)?' + clock + r')?\s*'
                               r'(?!到|至|点|分|半|[-–])[^\W\d_][^\s，,；;。！？!?]*[。！!]*', message)
    if timed_action and re.search(r'不行|不能|不要|不想|取消|有考试|有课|提前|推迟', message):
        timed_action = None
    part_action = re.fullmatch(r'\s*' + day + r'(?P<part>上午|下午|晚上|早上|中午)\s*'
                              r'(?!不|没|别|有考试|有课|之前|之后)[^\W\d_][^\s，,；;。！？!?]+[。！!]*', message)
    if part_action and re.search(r'不行|不能|不要|不想|取消|提前|推迟', message):
        part_action = None
    if not (explicit_target or short_target or initial_target or timed_action or part_action) or re.search(day + r'\s*(?:之前|以前|之后|以后|前|后)', message):
        raise ValueError('相对日期可能只是背景或范围，请明确目标日期，例如“安排到明天”')
    target = (date.fromisoformat(runtime_date) + timedelta(days=days[day])).isoformat()
    result = [slot for slot in candidates if slot.date == target]
    if part_action:
        start, end = {'上午': ('08:00', '12:00'), '早上': ('08:00', '12:00'), '中午': ('12:00', '14:00'),
                      '下午': ('12:00', '18:00'), '晚上': ('18:00', '22:00')}[part_action.group('part')]
        result = [slot for slot in result if slot.startTime >= start and slot.endTime <= end]
    return bounded(result)


class TimeReplanService:
    """Suggests one safe move or one task placement. It never writes a ScheduleEvent."""

    def __init__(self, provider, *, now=None):
        self.provider = provider
        self.now = now or current_time

    def _runtime(self) -> datetime:
        value = self.now()
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError('运行时钟必须包含时区')
        return value.astimezone(USER_TIMEZONE)

    def _check_slot(self, slot: TimeSlot, runtime_date: str) -> None:
        now = self._runtime()
        start = datetime.fromisoformat(f'{slot.date}T{slot.startTime}:00').replace(tzinfo=USER_TIMEZONE)
        if now.date().isoformat() != runtime_date or start < now:
            raise ValueError('目标时间已经过去，请重新生成建议')

    def _check_original(self, event) -> None:
        start = datetime.fromisoformat(f'{event.date}T{event.startTime}:00').replace(tzinfo=USER_TIMEZONE)
        if start <= self._runtime():
            raise ValueError('已经开始的时间块不能被移动')

    def _target(self, context: AgentContext, event_id: str) -> tuple[SchedulingTaskEventFact, object]:
        if context.schedule is None:
            raise ValueError('时间表缺少本周排程事实')
        event = next((item for item in context.schedule.events if item.eventId == event_id), None)
        if event is None:
            raise ValueError('要调整的时间块不存在')
        if event.kind != 'TASK':
            raise ValueError('只能调整用户的任务时间块')
        if not event.adjustable:
            raise ValueError('这个时间块当前不可调整')
        # Explicit linked facts are authoritative for this Time request; root tasks remain DateOnly facts.
        # Older clients can only move tasks already present in their dated root collection.
        facts = context.schedule.linkedTaskFacts
        task = next((item for item in (facts if facts is not None else context.tasks)
                     if item.id == event.taskId), None)
        if task is None:
            raise ValueError('时间块对应的任务不存在')
        if task.status not in ('TODO', 'DELAYED'):
            raise ValueError('只能调整未完成任务的时间块')
        return event, task

    def _unscheduled_task(self, context: AgentContext, task_id: str, duration_minutes: int | None = None):
        if context.schedule is None:
            raise ValueError('时间表缺少本周排程事实')
        task = next((item for item in context.schedule.unscheduledTasks if item.id == task_id), None)
        if task is None:
            raise ValueError('要安排的任务不在本周上下文中')
        if task.status not in ('TODO', 'DELAYED'):
            raise ValueError('只能安排未完成的任务')
        if duration_minutes is None and (task.estimatedMinutes is None or task.estimatedMinutes <= 0):
            raise ValueError('请先填写预计时长，再让智能体安排')
        return task

    def _check_window(self, context: AgentContext, runtime_date: str, *, allow_future: bool = False) -> None:
        if self._runtime().date().isoformat() != runtime_date:
            raise ValueError('运行日期已改变，请重新构建本周时间事实')
        if context.currentPeriod.status != 'ACTIVE':
            raise ValueError('当前阶段不是进行中')
        if context.timeWindow and not allow_future:
            raise ValueError('移动时间块请使用当前周上下文')
        if context.timeWindow and allow_future:
            horizon_end = (date.fromisoformat(runtime_date) + timedelta(days=13)).isoformat()
            if (context.timeWindow.startDate != runtime_date or context.timeWindow.endDate > horizon_end
                    or not context.currentPeriod.startDate <= runtime_date <= context.currentPeriod.endDate):
                raise ValueError('排程窗口必须从今天起且不超过14天')
            if context.schedule is None:
                raise ValueError('时间表缺少排程事实')
            return
        if not context.currentWeek.windowStart <= runtime_date <= context.currentWeek.windowEnd and not (
                allow_future and runtime_date < context.currentWeek.windowStart):
            raise ValueError('运行日不在当前周')
        start = date.fromisoformat(context.currentWeek.windowStart)
        end = date.fromisoformat(context.currentWeek.windowEnd)
        if not 0 <= (end - start).days <= 6 or not (
                context.currentPeriod.startDate <= start.isoformat() <= end.isoformat() <= context.currentPeriod.endDate):
            raise ValueError('所选周窗口无效')
        if not context.currentPeriod.startDate <= runtime_date <= context.currentPeriod.endDate:
            raise ValueError('运行日不在当前阶段')
        if context.schedule is None:
            raise ValueError('时间表缺少本周排程事实')

    def _candidates(self, context: AgentContext, duration: int, runtime_date: str, *,
                    exclude_event_id: str | None = None,
                    original: tuple[str, str, str] | None = None) -> list[TimeSlot]:
        if context.schedule is None:
            return []
        now = self._runtime()
        if now.date().isoformat() != runtime_date:
            raise ValueError('运行日期已改变')
        period_start = date.fromisoformat(context.currentPeriod.startDate)
        period_end = date.fromisoformat(context.currentPeriod.endDate)
        week_start = max(date.fromisoformat(context.timeWindow.startDate if context.timeWindow else context.currentWeek.windowStart), period_start)
        week_end = min(date.fromisoformat(context.timeWindow.endDate if context.timeWindow else context.currentWeek.windowEnd),
                       period_end, date.fromisoformat(runtime_date) + timedelta(days=13))
        earliest_day = max(week_start, date.fromisoformat(runtime_date))
        started = time.perf_counter(); conflict_ms = 0.0
        blocked_by_day = {}
        for item in context.schedule.events:
            if item.eventId != exclude_event_id:
                blocked_by_day.setdefault(item.date, []).append((item.startTime, item.endTime))
        candidates: list[TimeSlot] = []
        day = earliest_day
        while day <= week_end:
            day_text = day.isoformat()
            for start in range(DAY_START_MINUTES, DAY_END_MINUTES - duration + 1, GRID_MINUTES):
                end = start + duration
                if datetime.combine(day, datetime.min.time(), tzinfo=USER_TIMEZONE) + timedelta(minutes=start) < now:
                    continue
                if original is not None and day_text == original[0] and start == _minutes(original[1]) \
                        and end == _minutes(original[2]):
                    continue
                checked = time.perf_counter()
                conflict = any(_overlaps(start, end, _minutes(left), _minutes(right)) for left, right in blocked_by_day.get(day_text, ()))
                conflict_ms += (time.perf_counter()-checked)*1000
                if conflict:
                    continue
                candidates.append(TimeSlot(date=day_text, startTime=_time(start), endTime=_time(end)))
            day += timedelta(days=1)
        emit('replan_candidates', {'candidate_build_ms':(time.perf_counter()-started)*1000,
             'conflict_check_ms':conflict_ms,'candidate_count':len(candidates),'event_count':len(context.schedule.events)})
        return candidates

    async def _choose(self, prompt, candidates: list[TimeSlot]) -> tuple[TimeMoveDraft, TimeSlot]:
        raw = await self.provider.propose_time_move(prompt)
        draft = TimeMoveDraft.model_validate(raw.model_dump() if isinstance(raw, TimeMoveDraft) else raw)
        chosen = next((item for item in candidates if item.date == draft.date
                       and item.startTime == draft.startTime and item.endTime == draft.endTime), None)
        if chosen is None:
            raise ValueError('模型返回的时间槽不在应用提供的候选中')
        return draft, chosen

    async def propose(self, context: AgentContext, event_id: str, runtime_date: str,
                      user_message: str, duration_minutes: int | None = None) -> TimeMoveProposal:
        snapshot = deepcopy(context)
        self._check_window(snapshot, runtime_date, allow_future=True)
        event, task = self._target(snapshot, event_id)
        self._check_original(event)
        if duration_minutes is not None and (type(duration_minutes) is not int or not 1 <= duration_minutes <= 240):
            raise ValueError('调整时长必须为1至240的整数分钟')
        duration = duration_minutes if duration_minutes is not None else _minutes(event.endTime) - _minutes(event.startTime)
        candidates = self._candidates(snapshot, duration, runtime_date,
                                      exclude_event_id=event.eventId,
                                      original=(event.date, event.startTime, event.endTime))
        candidates = _relative_candidates(candidates, runtime_date, user_message)
        if not candidates:
            raise ValueError('本周没有符合请求时长的可用时间槽，无法安全调整')
        prompt = build_time_replan_prompt(snapshot, event, task, [item.model_dump() for item in candidates], user_message,
                                         runtime_date=runtime_date, requested_minutes=duration_minutes)
        draft, chosen = await self._choose(prompt, candidates)
        self._check_original(event)
        self._check_slot(chosen, runtime_date)
        now = self._runtime()
        return TimeMoveProposal(
            proposalId=uuid4().hex,
            eventId=event.eventId,
            taskId=event.taskId,
            before=TimeSlot(date=event.date, startTime=event.startTime, endTime=event.endTime),
            after=chosen,
            reason=draft.reason,
            candidates=candidates,
            createdAt=now,
            expiresAt=now + timedelta(minutes=15),
        )

    async def propose_schedule(self, context: AgentContext, task_id: str, runtime_date: str,
                               user_message: str, duration_minutes: int | None = None) -> TimeScheduleProposal:
        snapshot = deepcopy(context)
        self._check_window(snapshot, runtime_date, allow_future=True)
        if duration_minutes is not None and (type(duration_minutes) is not int or not 1 <= duration_minutes <= 240):
            raise ValueError('排程时长必须为1至240的整数分钟')
        task = self._unscheduled_task(snapshot, task_id, duration_minutes)
        duration = duration_minutes if duration_minutes is not None else task.estimatedMinutes
        candidates = self._candidates(snapshot, duration, runtime_date)
        candidates = _relative_candidates(candidates, runtime_date, user_message)
        if not candidates:
            raise ValueError('没有符合本次指定时长的可用空档，无法安全安排这个任务')
        prompt = build_schedule_task_prompt(snapshot, task, [item.model_dump() for item in candidates], user_message + (f' 本次时长指定为{duration}分钟，不修改任务原预计时长。' if duration_minutes is not None else ''),
                                           runtime_date=runtime_date, duration_minutes=duration_minutes)
        draft, chosen = await self._choose(prompt, candidates)
        self._check_slot(chosen, runtime_date)
        if _minutes(chosen.endTime) - _minutes(chosen.startTime) != duration:
            raise ValueError('模型建议时长与本次指定时长不一致')
        now = self._runtime()
        return TimeScheduleProposal(
            proposalId=uuid4().hex,
            taskId=task.id,
            after=chosen,
            reason=draft.reason,
            candidates=candidates,
            createdAt=now,
            expiresAt=now + timedelta(minutes=15),
        )

    async def propose_new_task(self, context: AgentContext, runtime_date: str,
                               user_message: str) -> CreateAndScheduleProposal:
        snapshot = deepcopy(context)
        self._check_window(snapshot, runtime_date, allow_future=True)
        candidates = _relative_candidates(self._candidates(snapshot, 30, runtime_date), runtime_date, user_message)
        if not candidates:
            raise ValueError('所选周没有合法空档')
        prompt = build_create_and_schedule_prompt(snapshot, [s.model_dump() for s in candidates], user_message, runtime_date=runtime_date)
        raw = await self.provider.propose_create_and_schedule(prompt)
        draft = CreateAndScheduleDraft.model_validate(raw.model_dump() if isinstance(raw, CreateAndScheduleDraft) else raw)
        duration = _minutes(draft.endTime) - _minutes(draft.startTime)
        if duration < 30 or duration > 240 or duration % 30:
            raise ValueError('新建任务时长必须是30至240分钟的30分钟整数倍')
        legal = _relative_candidates(self._candidates(snapshot, duration, runtime_date), runtime_date, user_message)
        slot = TimeSlot(date=draft.date, startTime=draft.startTime, endTime=draft.endTime)
        if slot not in legal:
            raise ValueError('模型返回的时间槽不在合法候选中')
        facts = [*snapshot.tasks, *snapshot.schedule.unscheduledTasks, *(snapshot.schedule.linkedTaskFacts or [])]
        if any(t.title.strip().casefold() == draft.taskTitle.casefold() for t in facts):
            raise ValueError('已有同名任务，请选择已有任务安排')
        self._check_slot(slot, runtime_date)
        now = self._runtime()
        return CreateAndScheduleProposal(**draft.model_dump(), proposalId=uuid4().hex,
            createdAt=now, expiresAt=now + timedelta(minutes=15))
