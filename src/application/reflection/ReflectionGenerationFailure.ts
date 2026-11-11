import type { AgentContext } from '@/domain/agent/types';

/** Facts from the same request snapshot, not an AI draft or a persistence result. */
export class ReflectionGenerationFailure extends Error {
  readonly reflectionRecovery: 'unknown' | 'not_started' | 'failed' | 'unavailable';
  readonly factualSummary: string;
  constructor(context: AgentContext, cause?: unknown) {
    const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
    super(code === 'REFLECTION_WAIT_TIMEOUT' ? '复盘等待超时，结果尚未确认；请先查看历史，避免重复生成'
      : code === 'REFLECTION_CACHE_UNAVAILABLE' ? '复盘缓存无法访问，请检查后端运行账户对缓存目录的写入权限及磁盘状态；没有自动重试'
      : code === 'REFLECTION_SNAPSHOT_CHANGED' ? '原请求事实已变化，无法安全恢复'
      : code === 'REFLECTION_REQUEST_UNKNOWN' ? '原请求已过期或后端已重启，无法确认结果；没有重新生成'
      : code === 'REFLECTION_INVALID_HANDLE' ? '复盘请求编号格式无效，可以重新发起本周复盘'
      : code === 'REFLECTION_INVALID_INPUT' ? '复盘资料未通过校验；请刷新本周数据后再试，此次未开始生成'
      : code === 'BACKEND_UNREACHABLE' ? '暂时无法连接 AI 服务，请检查后端和网络'
      : 'AI 生成或证据校验未完成，未保存新的复盘或记忆');
    this.name = 'ReflectionGenerationFailure';
    const recovery = cause && typeof cause === 'object' && 'reflectionRecovery' in cause ? cause.reflectionRecovery : 'unknown';
    this.reflectionRecovery = recovery === 'not_started' || recovery === 'failed' || recovery === 'unavailable' ? recovery : 'unknown';
    const facts = context.reviewFacts;
    this.factualSummary = `客观周报（程序统计，非 AI 分析）\n统计范围：${facts.windowStart} 至 ${facts.windowEnd}（请求发起时的记录）。`
      + `\n本周计划 ${facts.plannedTaskCount} 项，完成 ${facts.completedTaskCount} 项，记录成果 ${facts.achievementCount} 项。`
      + (facts.actualMinutes === null ? '\n实际用时记录不完整，暂不判断投入时长。' : `\n本周计划任务已记录实际用时 ${facts.actualMinutes} 分钟。`)
      + '\n这些统计不能直接代表长期目标进展。此前有效复盘仍可从历史查看；没有自动重试。';
  }
}
