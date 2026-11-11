import json
from functools import lru_cache
from app.services.performance import stage, emit
from typing import TypeVar
from pydantic import BaseModel

from app.models.replan import WeeklyReplanDraft
from app.models.replan_stages import ReplanActionBatch
from app.models.reflection import WeeklyReflectionDraft, GeneratedWeeklyReflectionDraft
from .base import InvalidStructuredOutputError

Draft = TypeVar('Draft', bound=BaseModel)


@lru_cache(maxsize=32)
def compact_schema(draft_type: type[BaseModel]) -> str:
    # Cache immutable serialized contracts; preserve every schema annotation.
    return json.dumps(draft_type.model_json_schema(), ensure_ascii=False, separators=(',', ':'))


def build_payload(model: str, system: str, user: str, draft_type: type[Draft]) -> dict:
    if draft_type is WeeklyReflectionDraft:
        draft_type = GeneratedWeeklyReflectionDraft
    constraints = (
        '\n输出合约（可信格式约束）：只输出一个符合下方 JSON Schema 的 JSON object，'
        '不输出 Markdown、解释或已执行声明。所有 required 字段必须存在，禁止额外字段；'
        '字段名、类型和 enum 必须准确。null、省略字段和 0 不等价，不补造事实或记忆。'
    )
    if draft_type in (WeeklyReplanDraft, ReplanActionBatch):
        constraints += (
            ' update_task.arguments.changes 必须至少包含一个需要修改的非 null 计划字段，'
            '未修改字段必须省略，不填 null。不得生成授权 ID 或 expectedChanges；所有动作仅为待确认建议。'
        )
    metrics = {}
    with stage(metrics, 'schema_build_ms'):
        schema = compact_schema(draft_type)
    emit('schema', metrics)
    return {
        'model': model, 'temperature': 0.2,
        'messages': [{'role': 'system', 'content': system + constraints + '\nJSON Schema:\n' + schema},
                     {'role': 'user', 'content': user}],
        'response_format': {'type': 'json_object'},
    }


def _unique_object(pairs: list[tuple]) -> dict:
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('Duplicate JSON key')
        value[key] = item
    return value


def _reject_constant(value: str):
    raise ValueError('Non-standard JSON constant')


def parse_response(body: dict, draft_type: type[Draft]) -> Draft:
    if draft_type is WeeklyReflectionDraft:
        draft_type = GeneratedWeeklyReflectionDraft
    try:
        choice = body['choices'][0]
        if not isinstance(choice, dict) or choice.get('finish_reason') in ('length', 'content_filter', 'tool_calls'):
            raise ValueError('Invalid or incomplete completion')
        message = choice['message']
        if not isinstance(message, dict) or message.get('refusal') or message.get('tool_calls'):
            raise ValueError('Refusal or unexpected tool calls')
        content = message['content']
        if isinstance(content, list):
            if not content or any(not isinstance(part, dict) or part.get('type', 'text') != 'text'
                                  or not isinstance(part.get('text'), str) for part in content):
                raise ValueError('Invalid text blocks')
            content = ''.join(part['text'] for part in content)
        if not isinstance(content, str):
            raise ValueError('Missing text content')
        content = content.strip()
        value = json.loads(content, object_pairs_hook=_unique_object, parse_constant=_reject_constant)
        if not isinstance(value, dict):
            raise ValueError('Expected a JSON object')
        return draft_type.model_validate_json(content)
    except (KeyError, IndexError, TypeError, ValueError) as error:
        raise InvalidStructuredOutputError(f'模型返回内容不符合 {draft_type.__name__}') from error
