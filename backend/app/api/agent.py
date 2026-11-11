from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from app.agent.tools.registry import TOOL_REGISTRY
from app.llm.base import LLMProviderError, LLMTimeoutError, LLMRateLimitError
from app.models.actions import AgentActionProposal, ActionAuthorization, ExecuteRequest, ProposeRequest

router = APIRouter(prefix='/api/v1/agent', tags=['agent'])


@router.post('/propose', response_model=AgentActionProposal)
async def propose(payload: ProposeRequest, request: Request):
    try:
        draft = await request.app.state.llm_provider.propose_actions(
            payload.context, payload.user_message, [tool.llm_schema() for tool in TOOL_REGISTRY.values()])
        return request.app.state.agent_actions.propose(draft, payload.context)
    except LLMProviderError as error:
        status = 504 if isinstance(error, LLMTimeoutError) else 503 if isinstance(error, LLMRateLimitError) else 502
        raise HTTPException(status, detail={'code': error.code, 'message': 'AI 建议生成失败，请检查服务配置或重试'}) from error
    except ValidationError as error:
        raise HTTPException(422, detail={'code': 'INVALID_ACTION', 'message': 'AI 操作建议的参数格式无效'}) from error
    except ValueError as error:
        raise HTTPException(422, detail={'code': 'INVALID_ACTION', 'message': 'AI 操作建议无效：' + str(error)}) from error


@router.post('/execute', response_model=ActionAuthorization)
async def execute(payload: ExecuteRequest, request: Request):
    # This endpoint authorizes only. It must never claim the local DB was written.
    try:
        return request.app.state.agent_actions.authorize(payload.actionId, payload.approval)
    except ValueError as error:
        raise HTTPException(409, detail={'code': 'ACTION_NOT_AVAILABLE', 'message': str(error)}) from error
