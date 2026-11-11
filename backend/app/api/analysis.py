from fastapi import APIRouter, HTTPException, Request

from app.llm.base import (
    InvalidStructuredOutputError,
    LLMAuthenticationError,
    LLMProvider,
    LLMProviderError,
    LLMRateLimitError,
    LLMTimeoutError,
)
from app.models.analysis import WeeklyAnalysisResult
from app.models.context import WeeklyAnalysisRequest
from app.services.prompt_builder import build_weekly_analysis_prompt

router = APIRouter(prefix="/api/v1/analysis", tags=["analysis"])


def get_provider(request: Request) -> LLMProvider:
    return request.app.state.llm_provider


@router.post("/weekly", response_model=WeeklyAnalysisResult)
async def analyze_weekly(payload: WeeklyAnalysisRequest, request: Request) -> WeeklyAnalysisResult:
    try:
        return await get_provider(request).analyze_weekly(
            build_weekly_analysis_prompt(payload.context, payload.user_message)
        )
    except LLMTimeoutError as error:
        raise HTTPException(504, detail={"code": error.code, "message": "AI 分析超时，请稍后重试"}) from error
    except LLMAuthenticationError as error:
        raise HTTPException(502, detail={"code": error.code, "message": "AI 服务配置无效"}) from error
    except LLMRateLimitError as error:
        raise HTTPException(503, detail={"code": error.code, "message": "AI 服务繁忙，请稍后重试"}) from error
    except InvalidStructuredOutputError as error:
        raise HTTPException(502, detail={"code": error.code, "message": "AI 返回格式无效，请重试"}) from error
    except LLMProviderError as error:
        raise HTTPException(502, detail={"code": error.code, "message": "AI 服务暂时不可用"}) from error
