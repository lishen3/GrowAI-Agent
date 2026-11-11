from dataclasses import dataclass

from app.models.context import AgentContext

SYSTEM_INSTRUCTION = """你是 GrowAI 的成长分析模块。你的任务是根据提供的结构化事实分析本周执行情况。

必须遵守：
1. 只能使用 AgentContext 中明确提供的事实，不得发明执行记录、习惯、心理状态或原因。
2. null 表示未知，不能当作 0；未记录不能表述为未执行。
3. CANCELLED 是取消事实，不是失败，也不属于 unfinished。
4. observation 必须说明证据；suggestion 必须保持为建议，不能写成已发生事实。
5. 数据不足时写入 data_gaps。
6. 语言客观、克制，不说教、不使用情绪化评价。
7. 只输出符合 WeeklyAnalysisResult JSON Schema 的 JSON，不输出 Markdown。
8. memories 是经用户确认的历史结论，仍可能属于推断；不得当作本周新执行事实。"""


@dataclass(frozen=True)
class WeeklyAnalysisPrompt:
    system_instruction: str
    context_json: str
    user_message: str | None


def build_weekly_analysis_prompt(
    context: AgentContext,
    user_message: str | None,
) -> WeeklyAnalysisPrompt:
    return WeeklyAnalysisPrompt(
        system_instruction=SYSTEM_INSTRUCTION,
        context_json=context.model_dump_json(),
        user_message=user_message.strip() if user_message and user_message.strip() else None,
    )
