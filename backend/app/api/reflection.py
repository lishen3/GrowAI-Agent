import logging
import time
from app.services.performance import stage, emit

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError, Field
from app.models.context import AgentContext, StrictModel
from app.llm.base import LLMProviderError, LLMTimeoutError, LLMRateLimitError
from app.models.context import WeeklyAnalysisRequest
from app.models.reflection import WeeklyReflectionDraft, GeneratedWeeklyReflectionDraft
from app.services.reflection_prompt import build_reflection_prompt
from app.services.reflection_evidence import ReflectionEvidenceError, validate_growth_reflection

router = APIRouter(prefix='/api/v1/reflection', tags=['reflection'])
logger = logging.getLogger(__name__)


class ReflectionJobRequest(WeeklyAnalysisRequest):
    request_id: str = Field(pattern=r'^request_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')


class ReflectionJobLookup(StrictModel):
    context: AgentContext | None = None
    request_id: str = Field(pattern=r'^request_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')


@router.post('/weekly/jobs', status_code=202)
async def start_reflection_job(payload: ReflectionJobRequest, request: Request):
    original = WeeklyAnalysisRequest(context=payload.context, user_message=payload.user_message)
    return request.app.state.reflection_jobs.start(payload.request_id, original.model_dump(mode='json'),
        lambda: reflect_weekly(original, request))


@router.post('/weekly/jobs/status')
async def read_reflection_job(payload: ReflectionJobLookup, request: Request):
    # Body-only capability: do not expose request handles in access-log URLs.
    return request.app.state.reflection_jobs.read(payload.request_id,
        WeeklyAnalysisRequest(context=payload.context, user_message=None).model_dump(mode="json") if payload.context else None)


@router.post('/weekly', response_model=WeeklyReflectionDraft)
async def reflect_weekly(payload: WeeklyAnalysisRequest, request: Request) -> WeeklyReflectionDraft:
    started=time.perf_counter(); metrics={}
    try:
        with stage(metrics, 'prompt_build_ms'):
            prompt=build_reflection_prompt(payload.context, payload.user_message)
        provider = request.app.state.llm_provider
        compact = getattr(provider, 'reflect_weekly_compact', None)
        result = await compact(payload.context, payload.user_message) if compact is not None else await provider.reflect_weekly(prompt)
        with stage(metrics, 'output_parse_ms'):
            draft = GeneratedWeeklyReflectionDraft.model_validate(result.model_dump() if isinstance(result, WeeklyReflectionDraft) else result)
        with stage(metrics, 'evidence_validation_ms'):
            validate_growth_reflection(payload.context, draft)
        return draft
    except LLMTimeoutError as error:
        raise HTTPException(504, detail={'code': error.code, 'message': 'AI 复盘超时，请重试'}) from error
    except LLMRateLimitError as error:
        raise HTTPException(503, detail={'code': error.code, 'message': 'AI 服务繁忙，请重试'}) from error
    except (ValidationError, ValueError, KeyError) as error:
        rule = error.rule if isinstance(error, ReflectionEvidenceError) else 'DRAFT_VALIDATION_FAILED'
        logger.warning('Reflection rejected rule=%s', rule)
        raise HTTPException(502, detail={'code': 'INVALID_STRUCTURED_OUTPUT', 'message': 'AI 复盘格式或证据无效，未保存复盘或记忆'}) from error
    except LLMProviderError as error:
        raise HTTPException(502, detail={'code': error.code, 'message': 'AI 复盘失败，未保存任何记忆'}) from error

    finally:
        metrics['total_duration_ms']=(time.perf_counter()-started)*1000
        emit('reflection_api',metrics)
