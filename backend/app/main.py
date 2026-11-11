import asyncio
import logging
from contextlib import asynccontextmanager, suppress
import os
import base64
import secrets

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles

from app.api.analysis import router as analysis_router
from app.api.agent import router as agent_router
from app.api.reflection import router as reflection_router
from app.api.replan import router as replan_router
from app.services.agent_action_service import AgentActionService
from app.services.demo_approval_flow import DemoApprovalFlow
from app.llm.base import LLMProvider
from app.llm.openai_compatible import OpenAICompatibleProvider
from app.services.reflection_jobs import ReflectionJobs
from app.services.reflection_job_cache import ReflectionJobCache, ReflectionCacheUnavailable, ReflectionCacheFull, local_cache_path

load_dotenv()


def _provider_from_env() -> LLMProvider:
    return OpenAICompatibleProvider(
        api_key=os.getenv("LLM_API_KEY", ""),
        base_url=os.getenv("LLM_BASE_URL", "https://api.openai.com/v1"),
        model=os.getenv("LLM_MODEL", ""),
        timeout_seconds=float(os.getenv("LLM_TIMEOUT_SECONDS", "30")),
    )


def create_app(provider: LLMProvider | None = None) -> FastAPI:
    jobs = ReflectionJobs(ReflectionJobCache(local_cache_path()) if provider is None else None)

    def cleanup_cache():
        try:
            jobs.cleanup()
        except ReflectionCacheUnavailable:
            # No private paths or request contents in logs; retry cleanup next tick.
            logging.getLogger(__name__).warning('REFLECTION_CACHE_UNAVAILABLE: cache cleanup could not complete')

    @asynccontextmanager
    async def lifespan(app):
        cleanup_cache()
        async def cleanup():
            while True:
                await asyncio.sleep(60)
                cleanup_cache()
        timer = asyncio.create_task(cleanup())
        try:
            yield
        finally:
            timer.cancel()
            with suppress(asyncio.CancelledError):
                await timer

    app = FastAPI(title="GrowAI智能体", version="作品提交", lifespan=lifespan)
    password = os.getenv('GROWAI_ACCESS_PASSWORD', '')

    @app.middleware('http')
    async def access(request, call_next):
        if password:
            expected = 'Basic ' + base64.b64encode(('growai:' + password).encode()).decode()
            supplied = request.headers.get('authorization', '').encode()
            if not secrets.compare_digest(supplied, expected.encode()):
                return JSONResponse({'detail': {'message': '请登录 GrowAI'}}, status_code=401,
                                    headers={'WWW-Authenticate': 'Basic realm="GrowAI", charset="UTF-8"'})
            origin = request.headers.get('origin')
            if (request.method == 'POST' and origin and origin not in origins
                    and origin != str(request.base_url).rstrip('/') and request.headers.get('sec-fetch-site') != 'same-origin'):
                return JSONResponse({'detail': {'message': '来源未获准'}}, status_code=403)
        elif request.client and (request.client.host not in ('127.0.0.1', '::1', 'testclient')
                or request.client.host != 'testclient' and request.url.hostname not in ('127.0.0.1', '::1', 'localhost')):
            return JSONResponse({'detail': {'message': '远程访问需要配置 GrowAI 登录密码'}}, status_code=403)
        return await call_next(request)
    @app.exception_handler(ReflectionCacheFull)
    @app.exception_handler(ReflectionCacheUnavailable)
    async def cache_unavailable(request, error):
        return JSONResponse(status_code=503, content={'detail': {'code': error.code, 'message': error.message}})

    app.state.llm_provider = provider or _provider_from_env()
    app.state.reflection_jobs = jobs
    app.state.agent_actions = AgentActionService()
    app.state.demo_approvals = DemoApprovalFlow()
    origins = [item.strip() for item in os.getenv(
        "FRONTEND_ORIGINS", "http://localhost:8081,http://localhost:19006"
    ).split(",") if item.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.include_router(analysis_router)
    app.include_router(agent_router)
    app.include_router(reflection_router)
    app.include_router(replan_router)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    web_dir = os.getenv('GROWAI_WEB_DIR')
    if web_dir:
        class ExportedWeb(StaticFiles):
            async def get_response(self, path, scope):
                if path != '.' and self.lookup_path(path + '.html')[1]:
                    path += '.html'
                return await super().get_response(path, scope)
        app.mount('/', ExportedWeb(directory=web_dir, html=True))
    return app


app = create_app()
