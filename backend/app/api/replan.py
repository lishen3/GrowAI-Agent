from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError
from app.llm.base import LLMProviderError, LLMTimeoutError, LLMRateLimitError
from app.models.actions import ProposeRequest
from app.models.replan import WeeklyReplanProposal
from app.services.replan_service import WeeklyReplanService
from app.models.planning_preview import PlanningPreviewRequest, PlanningPreviewResult
from app.services.lite_generator_service import LiteGeneratorService, PlanningPreviewError
from app.models.demo_approval import SubmitDemoApproval, DecideDemoApproval, PrepareDemoExecution, DemoExecutionValidation
from app.models.replan_approval import ApprovalRequest, ApprovalDecisionResult
from app.models.time_replan import TimeMoveProposal, TimeReplanRequest, TimeScheduleProposal, TimeScheduleRequest, CreateAndScheduleRequest, CreateAndScheduleProposal
from app.services.time_replan_service import TimeReplanService

router = APIRouter(prefix='/api/v1/replan', tags=['replan'])


@router.post('/date-only/preview', response_model=PlanningPreviewResult)
async def preview_date_only(payload: PlanningPreviewRequest, request: Request):
    # Generation retains a receipt only; no ApprovalRequest or Task write until explicit submission.
    constraints = {task.id: {'periodId': task.periodId, 'deadline': task.deadline} for task in payload.task_facts}
    try:
        if payload.session_id is not None:
            request.app.state.demo_approvals.ensure_capacity()
        result = await LiteGeneratorService(request.app.state.llm_provider).preview(
            payload.context, payload.user_message, runtime_date=payload.runtime_date,
            task_constraints=constraints, allowed_dates=set(payload.allowed_dates))
        return request.app.state.demo_approvals.retain(payload, result) if payload.session_id is not None else result
    except ValueError as error:
        raise HTTPException(409, detail={'code': 'DEMO_RECEIPT_BLOCKED', 'stage': 'RECEIPT',
            'message': '演示收据无法建立，未批准或修改任务'}) from error
    except PlanningPreviewError as failure:
        error = failure.error
        if isinstance(error, LLMProviderError):
            status = 504 if isinstance(error, LLMTimeoutError) else 503 if isinstance(error, LLMRateLimitError) else 502
            code = error.code
        else:
            status = 422 if isinstance(error, ValidationError) else 409 if isinstance(error, ValueError) else 500
            code = 'INVALID_DRAFT' if status == 422 else 'POLICY_BLOCKED' if status == 409 else 'PLANNING_FAILED'
        raise HTTPException(status, detail={'code': code, 'stage': failure.stage,
            'message': f'{failure.stage} 阶段失败（{code}），未批准或修改任务'}) from failure


@router.post('/date-only/approvals', response_model=ApprovalRequest)
async def submit_demo_approval(payload: SubmitDemoApproval, request: Request):
    try:
        return request.app.state.demo_approvals.create(payload.preview_id, payload.action_index, payload.facts)
    except (ValueError, KeyError) as error:
        raise HTTPException(409, detail={'code': 'APPROVAL_CREATE_BLOCKED', 'stage': 'APPROVAL',
            'message': '申请被阻断：收据无效、事实/会话变化或没有合法动作，请重新生成建议'}) from error


@router.post('/date-only/approvals/{approval_id}/approve', response_model=ApprovalDecisionResult)
async def approve_demo_approval(approval_id: str, payload: DecideDemoApproval, request: Request):
    return await request.app.state.demo_approvals.approve(
        approval_id, payload.userDecision, payload.confirmedContent, payload.facts)


@router.get('/date-only/approvals/{approval_id}/execution-authority')
async def demo_execution_authority(approval_id: str, request: Request):
    try:
        return request.app.state.demo_approvals.execution_approval(approval_id)
    except ValueError as error:
        raise HTTPException(409, detail={'code': 'APPROVAL_INVALID', 'message': '没有有效已批准授权'}) from error


@router.post('/date-only/approvals/{approval_id}/prepare-execution', response_model=DemoExecutionValidation)
async def prepare_demo_execution(approval_id: str, payload: PrepareDemoExecution, request: Request):
    try:
        return request.app.state.demo_approvals.prepare_execution(approval_id, payload.changeSet, payload.facts)
    except (ValueError, KeyError) as error:
        raise HTTPException(409, detail={'code': 'EXECUTION_BLOCKED',
            'message': '执行前校验失败或授权已领取，未由后端写入任务'}) from error


@router.post('/time/propose', response_model=TimeMoveProposal)
async def propose_time_move(payload: TimeReplanRequest, request: Request):
    try:
        return await TimeReplanService(request.app.state.llm_provider).propose(
            payload.context, payload.eventId, payload.runtime_date, payload.user_message, payload.duration_minutes)
    except LLMProviderError as error:
        status = 504 if isinstance(error, LLMTimeoutError) else 503 if isinstance(error, LLMRateLimitError) else 502
        raise HTTPException(status, detail={'code': error.code, 'message': 'AI 时间调整生成失败，未修改任何安排'}) from error
    except (ValidationError, ValueError) as error:
        raise HTTPException(422, detail={'code': 'INVALID_TIME_MOVE', 'message': '时间调整建议无效：' + str(error)}) from error


@router.post('/time/schedule', response_model=TimeScheduleProposal)
async def propose_time_schedule(payload: TimeScheduleRequest, request: Request):
    try:
        return await TimeReplanService(request.app.state.llm_provider).propose_schedule(
            payload.context, payload.taskId, payload.runtime_date, payload.user_message, payload.duration_minutes)
    except LLMProviderError as error:
        status = 504 if isinstance(error, LLMTimeoutError) else 503 if isinstance(error, LLMRateLimitError) else 502
        raise HTTPException(status, detail={'code': error.code, 'message': 'AI 时间安排生成失败，未修改任何安排'}) from error
    except (ValidationError, ValueError) as error:
        raise HTTPException(422, detail={'code': 'INVALID_TASK_SCHEDULE', 'message': '时间安排建议无效：' + str(error)}) from error


@router.post('/time/create-and-schedule', response_model=CreateAndScheduleProposal)
async def propose_create_and_schedule(payload: CreateAndScheduleRequest, request: Request):
    try:
        return await TimeReplanService(request.app.state.llm_provider).propose_new_task(
            payload.context, payload.runtime_date, payload.user_message)
    except LLMProviderError as error:
        status = 504 if isinstance(error, LLMTimeoutError) else 503 if isinstance(error, LLMRateLimitError) else 502
        raise HTTPException(status, detail={'code': error.code, 'message': 'AI 新建任务提案失败，未写入任务或安排'}) from error
    except (ValidationError, ValueError) as error:
        raise HTTPException(422, detail={'code': 'INVALID_CREATE_AND_SCHEDULE', 'message': '新建建议无效：' + str(error)}) from error


@router.post('/weekly', response_model=WeeklyReplanProposal)
async def replan_weekly(payload: ProposeRequest, request: Request):
    try:
        return await WeeklyReplanService(request.app.state.llm_provider, request.app.state.agent_actions).propose(payload.context, payload.user_message)
    except LLMProviderError as error:
        status = 504 if isinstance(error, LLMTimeoutError) else 503 if isinstance(error, LLMRateLimitError) else 502
        raise HTTPException(status, detail={'code': error.code, 'message': 'AI 重排生成失败，未修改计划'}) from error
    except (ValidationError, ValueError) as error:
        raise HTTPException(422, detail={'code': 'INVALID_REPLAN', 'message': '重排建议无效：' + str(error)}) from error
