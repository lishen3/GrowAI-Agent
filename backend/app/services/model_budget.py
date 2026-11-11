"""Reserve one worst-case call charge before each outbound model request."""
import os
import sqlite3
import time
from contextlib import closing, contextmanager
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.llm.base import LLMRateLimitError
from app.services.reflection_job_cache import local_cache_path


@contextmanager
def reserve_model_call():
    daily = os.getenv('GROWAI_DAILY_BUDGET_FEN')
    if daily is None and not os.getenv('GROWAI_ACCESS_PASSWORD'):
        yield
        return
    try:
        limit = int(daily or '0')
        ceiling = int(os.getenv('GROWAI_CALL_CEILING_FEN', '0'))
        concurrency = int(os.getenv('GROWAI_MAX_CONCURRENT', '2'))
    except ValueError:
        limit = ceiling = concurrency = 0
    if limit <= 0 or ceiling <= 0 or concurrency <= 0:
        raise LLMRateLimitError('模型预算未配置')
    file = local_cache_path().with_name('model-budget.sqlite3')
    file.parent.mkdir(parents=True, exist_ok=True)
    day = datetime.now(timezone(timedelta(hours=8))).date().isoformat()
    token = uuid4().hex
    with closing(sqlite3.connect(file)) as db:
        db.execute('CREATE TABLE IF NOT EXISTS usage(day TEXT PRIMARY KEY, reserved INTEGER NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS active(id TEXT PRIMARY KEY, expires REAL NOT NULL)')
        with db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM active WHERE expires <= ?', (time.time(),))
            used = db.execute('SELECT reserved FROM usage WHERE day=?', (day,)).fetchone()
            if (used[0] if used else 0) + ceiling > limit:
                raise LLMRateLimitError('今日模型预算已用完')
            if db.execute('SELECT count(*) FROM active').fetchone()[0] >= concurrency:
                raise LLMRateLimitError('模型请求繁忙')
            db.execute('INSERT INTO usage VALUES(?,?) ON CONFLICT(day) DO UPDATE SET reserved=reserved+excluded.reserved', (day, ceiling))
            db.execute('INSERT INTO active VALUES(?,?)', (token, time.time() + 310))
        try:
            yield
        finally:
            with db:
                db.execute('DELETE FROM active WHERE id=?', (token,))
