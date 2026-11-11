"""Request-local numerical metrics only; never retain prompts or model content."""
import logging
import time
from contextlib import contextmanager

logger = logging.getLogger(__name__)


@contextmanager
def stage(metrics: dict, name: str):
    started = time.perf_counter()
    try:
        yield
    finally:
        metrics[name] = round((time.perf_counter() - started) * 1000, 3)


def emit(kind: str, metrics: dict):
    logger.info('GrowAI performance kind=%s metrics=%s', kind, metrics)
