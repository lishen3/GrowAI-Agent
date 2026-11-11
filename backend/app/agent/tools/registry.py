from .create_task import create_task
from .update_task import update_task

TOOL_REGISTRY = {tool.name: tool for tool in (create_task, update_task)}
