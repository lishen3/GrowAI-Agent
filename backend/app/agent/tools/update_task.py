from app.models.actions import UpdateTaskArguments
from .base import ToolDefinition

update_task = ToolDefinition('update_task', '建议修改未完成任务的计划字段，不得修改任何历史事实。', UpdateTaskArguments)
