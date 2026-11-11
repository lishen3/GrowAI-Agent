"""Local, short-lived recovery cache. Never store credentials or model reasoning."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3
import time


class ReflectionCacheFull(Exception):
    code = 'REFLECTION_BUSY'
    message = '复盘请求记录已满，请稍后再试或查看已有复盘；未启动新的模型请求。'


class ReflectionCacheUnavailable(Exception):
    code = 'REFLECTION_CACHE_UNAVAILABLE'
    message = '复盘缓存无法访问，请检查后端运行账户对缓存目录的写入权限及磁盘状态；没有自动重试。'


def local_cache_path():
    # Resolve from this module, not the shell working directory.
    # The entire local-state directory is excluded from source control.
    return Path(__file__).resolve().parents[2] / '.local-state' / 'reflection-recovery.sqlite3'


class ReflectionJobCache:
    def __init__(self, path):
        self.path = Path(path)

    @contextmanager
    def connect(self):
        connection = None
        try:
            # On Windows inherit the user directory ACL; Unix mode 0700 creates
            # a new Windows ACL that may exclude a restricted process token.
            self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o777 if os.name == 'nt' else 0o700)
            connection = sqlite3.connect(self.path)
            with connection:
                connection.execute('PRAGMA secure_delete=ON')
                connection.execute('CREATE TABLE IF NOT EXISTS recovery (id TEXT PRIMARY KEY, expires REAL NOT NULL, record TEXT NOT NULL)')
                yield connection
        except (OSError, sqlite3.Error) as error:
            raise ReflectionCacheUnavailable() from error
        finally:
            if connection is not None:
                connection.close()

    @staticmethod
    def _expire(db, now):
        db.execute('DELETE FROM recovery WHERE expires <= ?', (now,))
        db.execute("""UPDATE recovery SET record = json_set(record, '$.status', 'failed', '$.error', json(?))
                      WHERE json_extract(record, '$.status') = 'pending' AND json_extract(record, '$.pendingUntil') <= ?""",
                   (json.dumps({'code': 'REFLECTION_INTERRUPTED', 'message': '原请求在执行时限内未保存结果，未重新生成'}), now))

    def cleanup(self):
        if not self.path.exists():
            return
        with self.connect() as db:
            self._expire(db, time.time())

    def load(self, key):
        if not self.path.exists():
            return None
        with self.connect() as db:
            self._expire(db, time.time())
            row = db.execute('SELECT record FROM recovery WHERE id = ?', (key,)).fetchone()
            return json.loads(row[0]) if row else None

    def claim(self, key, record):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            self._expire(db, time.time())
            existing = db.execute('SELECT record FROM recovery WHERE id = ?', (key,)).fetchone()
            if existing:
                return json.loads(existing[0])
            if db.execute('SELECT COUNT(*) FROM recovery').fetchone()[0] >= 32:
                raise ReflectionCacheFull()
            if record.get('status') == 'pending' and db.execute(
                """SELECT COUNT(*) FROM recovery WHERE json_extract(record, '$.status') = 'pending'"""
            ).fetchone()[0] >= 2:
                raise ReflectionCacheFull()
            db.execute('INSERT INTO recovery VALUES (?, ?, ?)', (key, record['wallExpires'], json.dumps(record, ensure_ascii=False)))
            return None

    def finish(self, key, record, owner):
        with self.connect() as db:
            now = time.time()
            result = db.execute("""UPDATE recovery SET record = ? WHERE id = ? AND expires > ?
                                   AND json_extract(record, '$.status') = 'pending'
                                   AND json_extract(record, '$.owner') = ?
                                   AND json_extract(record, '$.pendingUntil') > ?""",
                                (json.dumps(record, ensure_ascii=False), key, now, owner, now))
            if result.rowcount != 1:
                raise RuntimeError('Recovery claim no longer current')

    def fail_save(self, key, owner, error):
        # Preserve any concurrent terminal receipt, including a commit whose acknowledgement was lost.
        with self.connect() as db:
            self._expire(db, time.time())
            db.execute("""UPDATE recovery SET record = json_set(record, '$.status', 'failed', '$.error', json(?))
                          WHERE id = ? AND json_extract(record, '$.status') = 'pending'
                          AND json_extract(record, '$.owner') = ?""", (json.dumps(error), key, owner))
