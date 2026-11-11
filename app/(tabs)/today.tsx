import { useGrowthData } from '@/application/hooks/useGrowthData';
import { summarizeTodayTodos } from '@/application/hooks/todayTodos';
import { LocalDataMaintenanceService } from '@/application/data/LocalDataMaintenanceService';
import { useTodayExecution } from '@/application/hooks/useTodayExecution';
import { useWeeklyPlan } from '@/application/hooks/useWeeklyPlan';
import { usePageWriteGuard } from '@/application/hooks/usePageWriteGuard';
import { useCreationDraft } from '@/application/hooks/useCreationDraft';
import { calculatePeriodWeek, formatChineseDate, todayIso } from '@/shared/date';
import { AppText } from '@/presentation/components/AppText';
import { Button } from '@/presentation/components/Button';
import { Field } from '@/presentation/components/Field';
import { Notice } from '@/presentation/components/Notice';
import { Screen, ScreenSection } from '@/presentation/components/Screen';
import { Card, EmptyState, PageHeader, SectionHeader } from '@/presentation/components/ui/Layout';
import { selectTodayAchievements } from '@/application/tasks/TodayExecutionService';
import { TaskCompletionForm } from '@/presentation/components/TaskCompletionForm';
import { TodayTodoList } from '@/presentation/components/TodayTodoList';
import { TaskOverview } from '@/presentation/components/TaskOverview';
import { useCategories } from '@/application/hooks/useCategories';
import type { CompleteTaskInput, Task } from '@/domain/tasks/types';
import { useTheme } from '@/presentation/theme/tokens';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { createId } from '@/shared/id';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, View } from 'react-native';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export default function TodayScreen() {
  const theme = useTheme();
  const { store, journey, currentPeriod, loading, error } = useGrowthData();
  const today = todayIso();
  const categories = useCategories(store,journey?.id);
  const currentWeek = currentPeriod
    ? currentPeriod.currentWeekOverride ?? calculatePeriodWeek(
      currentPeriod.startDate, currentPeriod.endDate, today, currentPeriod.weekStartsOn,
    )
    : null;
  const calendarOffset = currentPeriod ? calculatePeriodWeek(currentPeriod.startDate, currentPeriod.endDate, today, currentPeriod.weekStartsOn) - currentWeek! : 0;
  const calendar = useWeeklyPlan(store, currentPeriod, calendarOffset);
  const execution = useTodayExecution(journey?.id ?? null, currentPeriod?.id ?? null, currentWeek, today,
    !calendar.loading && !calendar.error ? calendar.week?.events : [], currentPeriod);
  const [overviewRevision, setOverviewRevision] = useState(0);
  const [creation, setCreation, discardCreation] = useCreationDraft('today-task',
    journey && currentPeriod ? JSON.stringify([journey.id, currentPeriod.id, today]) : null,
    { open: false as boolean, title: '', estimatedMinutes: '', requestId: createId('task_form') });
  const { open: showCreate, title, estimatedMinutes } = creation;
  const setShowCreate = (open: boolean) => setCreation(value => ({ ...value, open }));
  const setTitle = (title: string) => setCreation(value => ({ ...value, title }));
  const setEstimatedMinutes = (estimatedMinutes: string) => setCreation(value => ({ ...value, estimatedMinutes }));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removingTask, setRemovingTask] = useState<Task | null>(null);
  const [completing, setCompleting] = useState<Task | null>(null);
  const unavailable = saving || loading || !!error || execution.loading || !!execution.error || calendar.loading || !!calendar.error;
  const assertWritable = usePageWriteGuard(loading || !!error || execution.loading || !!execution.error || calendar.loading || !!calendar.error,
    store, `${journey?.id}:${currentPeriod?.id}:${today}`);
  useEffect(() => { setCompleting(null); setRemovingTask(null); setActionError(null); setFeedback(null); },
    [store, journey?.id, currentPeriod?.id, today]);
  const todayAchievements = selectTodayAchievements(execution.achievements, journey?.id ?? '', currentPeriod?.id ?? '', today);
  const { plannedMinutes, actualMinutes } = summarizeTodayTodos(execution.todos, execution.executions ?? [], calendar.week?.events ?? [], today, currentPeriod?.id ?? '');

  async function deleteTask() {
    try { assertWritable(); } catch (caught) { setActionError((caught as Error).message); return; }
    if (!removingTask || !currentPeriod) return;
    setSaving(true); setActionError(null); setFeedback(null);
    try {
      await new LocalDataMaintenanceService(store).deleteTask(removingTask.id, currentPeriod.id);
      setRemovingTask(null); setOverviewRevision(value => value + 1);
      setFeedback('任务已删除。');
      await Promise.all([execution.reload(), calendar.reload()]);
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : '删除失败，任务已保留'); }
    finally { setSaving(false); }
  }

  async function submitTask() {
    try { assertWritable(); } catch (caught) { setFeedback(null); setActionError((caught as Error).message); return; }
    if (!currentPeriod || !title.trim()) return;
    setSaving(true); setActionError(null); setFeedback(null);
    try {
      const minutes = estimatedMinutes.trim() ? Number(estimatedMinutes) : undefined;
      if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 0)) throw new Error('预计时长必须是非负整数');
      await execution.createTask({
        periodId: currentPeriod.id, title: title.trim(), category: 'CUSTOM', priority: 'B',
        plannedDate: today, estimatedMinutes: minutes, categoryId: 'CUSTOM',
      }, creation.requestId);
      discardCreation();
      setOverviewRevision(value => value + 1);
      setFeedback('任务已保存，安排具体时间后才会进入今日待办。');
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '任务创建失败');
    } finally { setSaving(false); }
  }

  async function complete(input: CompleteTaskInput) {
    try { assertWritable(); } catch (caught) { setFeedback(null); setActionError((caught as Error).message); throw caught; }
    setSaving(true); setActionError(null); setFeedback(null);
    try {
      await execution.completeTask(input);
      setCompleting(null);
      setOverviewRevision(value => value + 1);
      setFeedback(input.actualMinutes === undefined ? '已完成；实际时长未记录。' : '任务、真实执行记录和成果已保存。');
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '任务完成失败');
      throw caught;
    } finally { setSaving(false); }
  }

  return <Screen>
    {loading || execution.loading ? <ActivityIndicator color={theme.primary} accessibilityLabel="正在刷新今日数据" /> : null}
    <PageHeader eyebrow="今天" title={`${greeting()}。`}
      subtitle={currentPeriod
        ? `${formatChineseDate(new Date())} · ${currentPeriod.name} · 第 ${currentWeek} 周`
        : formatChineseDate(new Date())} />

    {error ? <Notice title="当前数据尚未验证，暂不能写入">{error}。请重新读取阶段数据后再操作。</Notice> : null}

    {!currentPeriod ? <ScreenSection>
      <EmptyState title="先建立一个阶段" body="阶段可以是一个学期、假期、实习期或自定义时间段。之后的目标、课程和任务都会保存在这段经历里。"
        actionLabel="创建阶段" onAction={() => router.push('/period')} />
    </ScreenSection> : <>
      <View style={styles.stats}>
        <View style={styles.stat}><AppText variant="title">{execution.todos.filter(item => !item.completed).length}</AppText><AppText variant="caption" muted>待完成</AppText></View>
        <View style={styles.stat}><AppText variant="title">{todayAchievements.length}</AppText><AppText variant="caption" muted>今日成果</AppText></View>
        <View style={styles.stat}><AppText variant="title">{plannedMinutes}</AppText><AppText variant="caption" muted>计划分钟</AppText></View>
        <View style={styles.stat}><AppText variant="title">{actualMinutes}</AppText><AppText variant="caption" muted>实际分钟</AppText></View>
      </View>

      <ScreenSection>
        <SectionHeader title="今日待办" />
        {(!removingTask && actionError) || execution.error ? <Notice title="任务操作失败">{execution.error ?? actionError}</Notice> : null}
        {execution.error ? <Button label="重新读取今日数据" variant="secondary" onPress={() => void execution.reload()} /> : null}
        {feedback ? <Notice title="已更新">{feedback}</Notice> : null}
        {completing && completing.periodId === currentPeriod.id ? <TaskCompletionForm key={completing.id} task={completing} disabled={unavailable}
          onSubmit={complete} onCancel={() => setCompleting(null)} /> : null}
        {execution.loading ? <ActivityIndicator color={theme.primary} /> : null}
        {!loading && !error && !execution.loading && !execution.error && execution.todos.length === 0 ? <EmptyState title="今天还没有待办"
          body="到计划页安排今天的具体时间，事项就会出现在这里。" /> : null}
        <TodayTodoList key={`${journey?.id}:${currentPeriod.id}:${today}`} items={execution.todos} disabled={unavailable}
          categoryName={categories.name} onTask={task => { assertWritable(); setCompleting(task); }}
          onPersonal={async (id, completed) => { assertWritable(); await execution.setPersonalCompleted(id, completed); }} />
      </ScreenSection>

      <ScreenSection>
        <SectionHeader title="长期任务总览" action={<Button label="＋ 添加任务" disabled={unavailable}
          onPress={() => { setActionError(null); setShowCreate(true); }} />} />
        <TaskOverview key={`${journey?.id}:${currentPeriod.id}`} store={store} period={currentPeriod} revision={overviewRevision}
          deleteConfirmation={removingTask ? { taskId: removingTask.id, error: actionError,
            onConfirm: () => void deleteTask(), onCancel: () => setRemovingTask(null) } : undefined}
          disabled={unavailable} onDelete={task => { assertWritable(); setActionError(null); setRemovingTask(task); }} onSchedule={task => { assertWritable(); router.push({ pathname: '/plan', params: { taskId: task.id, periodId: currentPeriod.id } }); }} />
      </ScreenSection>

      {showCreate ? <Modal visible transparent animationType="fade" onRequestClose={() => { if (!saving) discardCreation(); }}>
        <View style={styles.modalBackdrop}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
            <Card style={styles.modalCard}>
              <AppText variant="heading">新建任务</AppText>
              <Field label="要做什么" value={title} onChangeText={setTitle} placeholder="例如：听力精听 20 分钟" maxLength={120} editable={!unavailable} />
              <Field label="预计分钟（可选）" value={estimatedMinutes} onChangeText={setEstimatedMinutes}
                keyboardType="number-pad" maxLength={4} editable={!unavailable} />
              {actionError ? <Notice title="任务未保存">{actionError}</Notice> : null}
              <Button label="添加任务" loading={saving} disabled={unavailable || !title.trim()} onPress={() => void submitTask()} />
              <Button label="取消添加" variant="quiet" disabled={saving} onPress={discardCreation} />
            </Card>
          </ScrollView>
        </View>
      </Modal> : null}

      {todayAchievements.length ? <ScreenSection>
        <SectionHeader title="今日成果" subtitle={`今天记录 ${todayAchievements.length} 项成果`} />
        {todayAchievements.map((achievement) => <View key={achievement.id} style={[styles.doneRow, { borderColor: theme.border }]}>
          <View style={styles.taskText}>
            <AppText variant="label" muted>✓ {achievement.title} · {categories.name(achievement.categoryId ?? achievement.category)}</AppText>
            <AppText variant="caption" muted>{achievement.actualDuration == null ? '实际用时未记录' : `实际 ${achievement.actualDuration} 分钟`}{achievement.result ? ` · ${achievement.result}` : ''}</AppText>
          </View>
          <AppText variant="caption" muted>已完成</AppText>
        </View>)}
      </ScreenSection> : null}

    </>}
  </Screen>;
}

const styles = StyleSheet.create({
  modalBackdrop: { flex: 1, backgroundColor: '#00000066' },
  modalContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 480, gap: 12 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 24, paddingVertical: 2 },
  stat: { gap: 1 },
  taskText: { flex: 1, gap: 3 },
  doneRow: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
});
