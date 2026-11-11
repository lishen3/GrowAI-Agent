from app.models.actions import CreateTaskArguments
from .base import ToolDefinition

create_task = ToolDefinition('create_task', '建议创建任务，必须等待用户确认，由本地应用服务执行。', CreateTaskArguments)
