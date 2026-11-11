import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { Button } from './Button';
import { Field } from './Field';
import { Notice } from './Notice';
import { Screen } from './Screen';
import { useTheme } from '../theme/tokens';
import type { DemoPlanningSnapshot, PlanningPreview } from '@/domain/replan/planningPreview';
import type { DemoApprovalRequest } from '@/domain/replan/approval';
import type { ApprovedChangeSet, ExecutionResult } from '@/domain/replan/execution';
import { ChoiceChip } from './ChoiceChip';

export type PlanningPageState = 'READY' | 'GENERATING' | 'PROPOSAL_READY' | 'AWAITING_APPROVAL' | 'APPROVED' | 'BLOCKED' | 'FAILED'
  | 'EXECUTING' | 'EXECUTED_SUCCESS' | 'EXECUTION_FAILED';
export type PlanningViewProps = {
  state: PlanningPageState; snapshot: DemoPlanningSnapshot | null; preview: PlanningPreview | null;
  error: string | null; allowedDate: string; loading: boolean;
  onDateChange: (date: string) => void; onGenerate: () => void; onBack: () => void;
  selectedAction?: number | null; approvalBusy?: boolean; approval?: DemoApprovalRequest | null; approved?: ApprovedChangeSet | null;
  onSelectAction?: (index: number) => void; onSubmitApproval?: () => void; onApprove?: () => void;
  onExecute?: () => void; executionResult?: ExecutionResult | null;
};

export function ReplanDemoPlanningView(props: PlanningViewProps) {
  const theme = useTheme();
  const { state, snapshot, preview, error } = props;
  const busy = props.loading || state === 'GENERATING' || state === 'EXECUTING' || props.approvalBusy === true;
  const approvalLocked = ['AWAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'EXECUTED_SUCCESS', 'EXECUTION_FAILED'].includes(state);
  const card = [styles.card, { backgroundColor: theme.surfaceStrong, borderColor: theme.border }];
  return <Screen contentContainerStyle={styles.content}>
    <View style={styles.header}>
      <AppText variant="eyebrow" style={{ color: theme.primary }}>DEMO · 建议 → 授权 → 日期调整</AppText>
      <AppText variant="title">调整日期，保留成长目标。</AppText>
      <AppText muted>读取独立 Demo Context，再生成受约束的建议。</AppText>
    </View>
    <Notice title="仅修改独立 Demo 任务日期">生成会请求真实模型。批准后仍需点击“执行调整”，只写 Demo plannedDate；不影响个人数据，不新增学习完成记录。</Notice>
    {error ? <Notice title={state === 'BLOCKED' ? '建议生成被阻断' : '建议生成失败'}>{error}</Notice> : null}
    <View style={card}>
      <AppText variant="heading">1 · 问题识别</AppText>
      <AppText variant="label">用户反馈</AppText>
      <AppText>最近英语任务压力比较大，帮我调整一下计划。</AppText>
      <AppText variant="label">真实 Context（独立 Demo 样本）</AppText>
      {snapshot ? <>
        <AppText variant="caption">{snapshot.context.currentPeriod.name} · {snapshot.context.currentWeek.windowStart} — {snapshot.context.currentWeek.windowEnd}</AppText>
        <AppText variant="caption">{snapshot.tasks.length} 个任务 · 已记录实际投入 {snapshot.context.planVsReality.actualMinutes === null ? '未知' : `${snapshot.context.planVsReality.actualMinutes} min`}</AppText>
        <AppText variant="caption" muted>读取时间：{snapshot.context.generatedAt}。TODO 不代表失败，历史偏好不是本周执行事实。</AppText>
      </> : <AppText muted>{props.loading ? '正在读取 Demo Context…' : '请先在“我的”进入独立 Demo 环境，再打开本页。'}</AppText>}
      <Field label="允许尝试日期（YYYY-MM-DD）" value={props.allowedDate} onChangeText={props.onDateChange} placeholder="明确允许的本周日期" editable={!busy && !approvalLocked} maxLength={10} />
      <AppText variant="caption" muted>点击生成表示仅允许建议尝试该日期，不代表课表容量已验证，也不是任务修改授权。</AppText>
      <Button label="查看调整建议" loading={state === 'GENERATING'} disabled={busy || approvalLocked || !snapshot || !props.allowedDate} onPress={props.onGenerate} />
      <AppText variant="caption" accessibilityLiveRegion="polite">{state === 'GENERATING' ? '正在运行 Planner → Candidate Builder → Generator → Policy，请等待；不自动重试。' : `状态：${state}`}</AppText>
    </View>
    <View style={card}>
      <AppText variant="heading">2 · AI 建议</AppText>
      <AppText variant="label">AI 判断（模型返回，不是执行事实）</AppText>
      {preview && snapshot ? <>
        <AppText>{preview.planner.summary}</AppText>
        {preview.planner.strategy.map((item, index) => <View key={index} style={styles.header}>
          <AppText variant="caption">{item.statement}</AppText><AppText variant="caption" muted>调整原因：{item.reason}</AppText>
          <AppText variant="caption" muted>Memory 引用：{item.basedOnMemoryIds.length ? item.basedOnMemoryIds.join('、') : '无引用'}</AppText>
        </View>)}
        <AppText variant="label">候选任务</AppText>
        {preview.candidates.candidateTaskIds.length ? preview.candidates.candidateTaskIds.map((id) => <AppText key={id} variant="caption">
          {snapshot.tasks.find((task) => task.id === id)?.title} · 允许尝试 {preview.candidates.allowedTargetDates[id].join('、')}
        </AppText>) : <AppText muted>没有可安全移动的候选任务。</AppText>}
        {Object.entries(preview.candidates.rejectedReasons).map(([id, reason]) => <AppText key={id} variant="caption" muted>排除：{snapshot.tasks.find((task) => task.id === id)?.title} · {reason}</AppText>)}
        {preview.draft.actions.length === 0 ? <Notice title="无需调整">本轮返回合法空 actions，未生成修改建议。</Notice> : null}
        {preview.draft.actions.map((action) => {
          const before = snapshot.tasks.find((task) => task.id === action.arguments.taskId)!;
          return <View key={before.id} style={[styles.datePanel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <AppText variant="label">{before.title}</AppText>
            <AppText variant="caption">Before：{before.plannedDate} → After：{action.arguments.changes.plannedDate}</AppText>
            <AppText variant="caption">预计投入：{before.estimatedMinutes === null ? '未知' : `${before.estimatedMinutes} min`}（不变） · 优先级 {before.priority}（不变）</AppText>
            <AppText variant="caption">关联目标：{before.weeklyGoalId ?? '未关联'}（不变）</AppText>
            <AppText variant="caption" muted>理由：{action.reason}</AppText>
          </View>;
        })}
      </> : <AppText muted>尚未取得合法 Planning 结果。</AppText>}
    </View>
    <View style={card}>
      <AppText variant="heading">3 · 安全验证</AppText>
      {preview ? <>
        <AppText variant="label" style={{ color: theme.primary }}>PASS · 后端 Policy 实际校验通过</AppText>
        {preview.policyChecks.map((check) => <AppText key={check.name} variant="caption">{check.name}：{check.result}</AppText>)}
        <AppText variant="caption" muted>只允许 plannedDate；目标、内容、投入和优先级不变。容量与时段冲突未验证。空动作通过不代表调整成功。</AppText>
      </> : <AppText muted>{state === 'BLOCKED' ? '未通过，见阻断原因。' : '尚未取得通过结果。'}</AppText>}
    </View>
    <View style={card}>
      <AppText variant="heading">4 · Approval</AppText>
      <AppText variant="caption" muted>每份申请只对应一个任务。提交不是确认，批准不是执行。</AppText>
      {state === 'PROPOSAL_READY' && preview?.draft.actions.length ? <>
        {!preview.previewId ? <AppText muted>未取得申请收据，请重新生成建议。</AppText> : null}
        {props.onSelectAction ? preview.draft.actions.map((action, index) => <ChoiceChip key={action.arguments.taskId}
          label={`选择：${snapshot?.tasks.find((task) => task.id === action.arguments.taskId)?.title}`}
          selected={props.selectedAction === index} onPress={() => { if (!busy) props.onSelectAction?.(index); }} />) : null}
        {props.onSubmitApproval ? <Button label="提交调整申请" loading={props.approvalBusy}
          disabled={busy || props.selectedAction == null || !preview.previewId} onPress={props.onSubmitApproval} /> : null}
      </> : null}
      {state === 'AWAITING_APPROVAL' && props.approval ? <>
        <AppText variant="label">等待确认</AppText>
        <AppText variant="caption">任务：{snapshot?.tasks.find((task) => task.id === props.approval!.proposedChanges[0].taskId)?.title}</AppText>
        <AppText variant="caption">{props.approval.proposedChanges[0].before.plannedDate} → {props.approval.proposedChanges[0].after.plannedDate}</AppText>
        <AppText variant="caption">理由：{props.approval.proposedChanges[0].reason}</AppText>
        <AppText variant="caption" muted>有效期截止：{props.approval.expiresAt}。确认前重新读取事实与校验 Policy。</AppText>
        {props.onApprove ? <Button label="确认调整" loading={props.approvalBusy} disabled={busy} onPress={props.onApprove} /> : null}
      </> : null}
      {state === 'APPROVED' && props.approved ? <>
        <AppText variant="label">已批准 · 未执行</AppText>
        <AppText variant="caption">ApprovedChangeSet：{props.approved.id}</AppText>
        <AppText variant="caption">批准时间：{props.approved.approvedAt}</AppText>
        <AppText variant="caption" muted>仅生成授权对象，不表示数据库已修改。</AppText>
      </> : null}
    </View>
    <View style={card}>
      <AppText variant="heading">5 · 执行结果</AppText>
      {state === 'APPROVED' && props.approved && props.onExecute ? <Button label="执行调整" disabled={busy} onPress={props.onExecute} /> : null}
      {state === 'EXECUTING' ? <AppText accessibilityLiveRegion="polite">正在校验授权、更新 Demo 日期并读取数据库验证…</AppText>
        : props.executionResult ? <>
          <AppText variant="label">{props.executionResult.status === 'SUCCESS' ? '调整完成' : '调整未验证成功'}</AppText>
          <AppText>任务：{props.executionResult.after?.title ?? props.executionResult.before?.title ?? props.approved?.expectedTaskFacts.title}</AppText>
          <AppText>日期：{props.executionResult.before?.plannedDate ?? props.approved?.changes[0].before.plannedDate} → {props.executionResult.after?.plannedDate ?? '未取得可信读回'}</AppText>
          <AppText>{props.executionResult.status === 'SUCCESS' ? 'Readback PASS · 日期已更新，其余字段不变' : `Readback 未通过 · ${props.executionResult.reason}`}</AppText>
          <AppText variant="caption" muted>{props.executionResult.status === 'SUCCESS' ? '独立 Demo 写入已提交并验证'
            : props.executionResult.writeOutcome === 'NOT_ATTEMPTED' ? '任务未写入'
            : props.executionResult.writeOutcome === 'COMMITTED' ? '写入已提交；失败时不要重复执行，请查看 Demo 数据'
            : '写入结果未知；不要重复执行，请查看 Demo 数据'}</AppText>
          <AppText variant="caption" muted>ExecutionResult：{props.executionResult.executionId}。仅独立 Demo，不创建 TaskExecution 或 Achievement。</AppText>
        </> : <AppText variant="label">未执行 · 数据库未修改</AppText>}
    </View>
    <Button label="返回 AI Coach" variant="quiet" onPress={props.onBack} />
  </Screen>;
}
const styles = StyleSheet.create({
  content: { maxWidth: 840, width: '100%', alignSelf: 'center', gap: 18 }, header: { gap: 8 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 }, datePanel: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
});
