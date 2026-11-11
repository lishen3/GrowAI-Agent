"""Bounded reflection results with optional local recovery. Handles are unguessable capabilities."""
import asyncio
from copy import deepcopy
import hashlib
import json
import time
from uuid import uuid4

from fastapi import HTTPException

JOB_TIMEOUT = 130
CLAIM_LIFETIME = JOB_TIMEOUT + 5
RESULT_LIFETIME = 1800


class ReflectionJobs:
    def __init__(self, cache=None):
        self.rows = {}
        self.cache = cache

    def _restore(self, key):
        saved = self.cache.load(key) if self.cache else None
        if saved:
            saved['expires'] = time.monotonic() + max(0, saved['wallExpires'] - time.time())
            # In older versions this exact marker represented either a restart or a live worker.
            if (saved.get('error') == {'code': 'REFLECTION_INTERRUPTED', 'message': '原生成已中断或由其他进程处理，未自动重试'}
                    and time.time() < saved['wallExpires'] - RESULT_LIFETIME + CLAIM_LIFETIME):
                saved['status'] = 'pending'
                saved.pop('error', None)
            if saved['status'] != 'pending':
                self.rows[key] = saved
        return saved

    def cleanup(self):
        self.rows = {key: row for key, row in self.rows.items()
                     if row['expires'] > time.monotonic() or row['status'] == 'pending'}
        if self.cache:
            self.cache.cleanup()

    @staticmethod
    def _persisted(row):
        return {key: value for key, value in row.items() if key not in ('task', 'expires')}


    def start(self, key, payload, work):
        now = time.monotonic()
        self.rows = {k: row for k, row in self.rows.items() if row['expires'] > now or row['status'] == 'pending'}
        digest = self.digest(payload)
        existing = self.rows.get(key) or self._restore(key)
        if existing:
            if existing['digest'] != digest:
                raise HTTPException(409, detail={'code': 'REFLECTION_REQUEST_CHANGED', 'message': '原请求内容已变化，未重新生成'})
            return self.read(key)
        if len(self.rows) >= 32 or sum(row['status'] == 'pending' for row in self.rows.values()) >= 2:
            raise HTTPException(503, detail={'code': 'REFLECTION_BUSY', 'message': '复盘服务繁忙，请先查看已有请求'})
        context = payload.get('context', {})
        scope = {'journeyId': context.get('journey', {}).get('id'), 'periodId': context.get('currentPeriod', {}).get('id'),
                 'weekStart': context.get('currentWeek', {}).get('windowStart'), 'weekEnd': context.get('currentWeek', {}).get('windowEnd')}
        wall_now = time.time()
        row = {'status': 'pending', 'digest': digest, 'expires': now + RESULT_LIFETIME, 'scope': scope, 'context': deepcopy(context), 'wallExpires': wall_now + RESULT_LIFETIME}
        if self.cache:
            owner = uuid4().hex
            marker = {**self._persisted(row), 'owner': owner, 'pendingUntil': wall_now + CLAIM_LIFETIME}
            marker.pop('context', None)
            existing = self.cache.claim(key, marker)
            if existing:
                if existing['digest'] != digest:
                    raise HTTPException(409, detail={'code': 'REFLECTION_REQUEST_CHANGED', 'message': '原请求内容已变化，未重新生成'})
                return self.read(key)
        self.rows[key] = row

        async def run():
            try:
                remaining = now + JOB_TIMEOUT - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('Job expired before dispatch')
                async with asyncio.timeout(remaining):
                    draft = await work()
                row.update(status='complete', draft=draft.model_dump(mode='json'))
            except HTTPException as error:
                row.update(status='failed', error=error.detail)
            except asyncio.CancelledError:
                row.update(status='failed', error={'code': 'REFLECTION_INTERRUPTED', 'message': '后端请求已中断，未自动重试'})
                raise
            except Exception:
                row.update(status='failed', error={'code': 'REFLECTION_FAILED', 'message': '复盘未完成，未自动重试'})
            finally:
                if self.cache:
                    try:
                        saved = self._persisted(row)
                        if row['status'] != 'complete':
                            saved.pop('context', None)
                        self.cache.finish(key, saved, owner)
                    except Exception:
                        row.pop('draft', None)
                        row.update(status='failed', error={'code': 'REFLECTION_SAVE_FAILED', 'message': '复盘恢复缓存保存失败，结果未确认；未自动重试'})
                        try:
                            self.cache.fail_save(key, owner, row['error'])
                            self._restore(key)
                        except Exception:
                            # If storage remains unavailable, the durable pending marker will expire.
                            pass
                row.pop('task', None)
        row['task'] = asyncio.create_task(run())
        return self.read(key)

    @staticmethod
    def digest(payload):
        context = {k: v for k, v in payload["context"].items() if k != "generatedAt"} if "context" in payload else None
        stable = {**payload, "context": context} if context is not None else payload
        return hashlib.sha256(json.dumps(stable, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

    def read(self, key, payload=None):
        row = self.rows.get(key) or self._restore(key)
        if row is None or (row['expires'] <= time.monotonic() and row['status'] != 'pending'):
            self.rows.pop(key, None)
            raise HTTPException(404, detail={'code': 'REFLECTION_REQUEST_UNKNOWN', 'message': '请求记录已过期或后端已重启，无法确认原结果；未重新生成'})
        if payload is not None and row['digest'] != self.digest(payload):
            raise HTTPException(409, detail={'code': 'REFLECTION_SNAPSHOT_CHANGED', 'message': '原请求事实已变化，无法安全恢复'})
        result = {field: row[field] for field in ('status', 'draft', 'error', 'scope') if field in row}
        if row['status'] == 'complete':
            result['context'] = deepcopy(row['context'])
        return result
