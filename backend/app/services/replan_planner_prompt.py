from app.models.context import AgentContext
from app.services.prompt_builder import WeeklyAnalysisPrompt
from app.services.replan_prompt import SYSTEM_INSTRUCTION as REPLAN_RULES

SYSTEM_INSTRUCTION = REPLAN_RULES.replace('只输出 WeeklyReplanDraft JSON', '只输出 ReplanPlannerDraft JSON') + '''
本阶段仅规划：输出 summary、diagnosis、strategy、adjustmentIntents，不输出 actions、toolName、arguments、授权 ID 或 expectedChanges。
最多三条诊断、三条策略、三个意图。无需调整或事实不足时 adjustmentIntents 可以为空；说明缺口，不能凑动作。
每个意图映射一个可独立确认的操作；update 使用真实 taskId、allowedFields 和 durationDirection。
reduce 表示缩短已知时长，preserve 表示不改变原时长，adjust 表示有证据支持的调整；未知时长不能宣称缩短。
用户明确指定的分钟数、日期、标题或说明必须保留为对应精确字段约束，不能以模糊 objective 替代。
create 给出建议任务的 title/category 与真实可选 weeklyGoalId，不通过创建同类任务代替需要更新的任务。
reason 是后续动作必须保留的建议理由，objective 说明方向但不是新事实。'''


def build_replan_planner_prompt(context: AgentContext, user_message: str) -> WeeklyAnalysisPrompt:
    return WeeklyAnalysisPrompt(SYSTEM_INSTRUCTION, context.model_dump_json(), user_message)
