from dataclasses import dataclass
import json

from app.models.context import AgentContext


class PlannerProjectionError(ValueError):
    """Conflicting or invalid source facts must fail before the Planner call."""


@dataclass(frozen=True)
class PlannerContextLite:
    facts: dict

    def model_dump_json(self) -> str:
        return json.dumps(self.facts, ensure_ascii=False, separators=(',', ':'))


def build_planner_context_lite(context: AgentContext) -> PlannerContextLite:
    # Revalidate even model_copy/model_construct inputs, without mutating the source.
    source = AgentContext.model_validate(context.model_dump()).model_dump()
    totals = source['planVsReality']
    review = source['reviewFacts']
    fields = ('plannedTaskCount', 'completedTaskCount', 'unfinishedTaskCount',
              'cancelledTaskCount', 'plannedMinutes', 'actualMinutes', 'categoryBreakdown')
    for field in fields:
        if totals[field] != review[field]:
            raise PlannerProjectionError(f'本周统计来源冲突：{field}')
    for field in ('windowStart', 'windowEnd'):
        if review[field] != source['currentWeek'][field]:
            raise PlannerProjectionError(f'本周窗口来源冲突：{field}')
    tasks = {task['id']: task for task in source['tasks']}
    if len(tasks) != len(source['tasks']):
        raise PlannerProjectionError('任务 ID 重复')
    for field in ('completedTasks', 'unfinishedTasks'):
        for task in totals[field]:
            if task['id'] in tasks:
                if tasks[task['id']] != task:
                    raise PlannerProjectionError(f'重复任务事实冲突：{field}')
                continue
            schedule = source.get('schedule') or {}
            linked = next((row for row in (schedule.get('linkedTaskFacts') or []) if row['id'] == task['id']), None)
            scheduled_here = any(row.get('taskId') == task['id'] and row['kind'] in ('TASK', 'AI_ADJUSTMENT')
                                 and source['currentWeek']['windowStart'] <= row['date'] <= source['currentWeek']['windowEnd']
                                 for row in schedule.get('events', []))
            if not linked or not scheduled_here or any(linked[key] != task[key] for key in ('id', 'title', 'status', 'plannedDate', 'estimatedMinutes')):
                raise PlannerProjectionError(f'重复任务事实冲突：{field}')
            # Review-only signals do not expand context.tasks or DateOnly candidates.
            tasks[task['id']] = task
    memory_ids = [memory['id'] for memory in source['memories']]
    if len(memory_ids) != len(set(memory_ids)):
        raise PlannerProjectionError('Memory ID 重复')
    return PlannerContextLite({
        'generatedAt': source['generatedAt'],
        'currentPeriod': {key: source['currentPeriod'][key]
                          for key in ('id', 'type', 'status', 'startDate', 'endDate')},
        'currentWeek': source['currentWeek'],
        **({'categories': source['categories']} if source.get('categories') is not None else {}),
        'longTermGoals': source['longTermGoals'],
        'periodGoals': source['periodGoals'],
        'weeklyGoals': source['weeklyGoals'],
        'taskSignals': list(tasks.values()),
        'executionFacts': source['recentExecutions'],
        'achievementFacts': source['recentAchievements'],
        'weekTotals': {key: totals[key] for key in fields},
        'memories': [{key: memory[key] for key in
                     ('id', 'type', 'content', 'evidence', 'confidence', 'sourceType', 'status')}
                    for memory in source['memories']],
    })
