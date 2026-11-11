import { usePageWriteGuard } from '@/application/hooks/usePageWriteGuard';
import { GoalTaskAssociationDialog } from './GoalTaskAssociationDialog';
import { GoalPlanningEditor } from './GoalPlanningEditor';
import { useGrowthData } from '@/application/hooks/useGrowthData';
import { GOAL_CATEGORIES, GOAL_CATEGORY_LABELS, type GoalCategory } from '@/domain/goals/types';
import { todayIso } from '@/shared/date';
import { AppText } from '@/presentation/components/AppText';
import { Button } from '@/presentation/components/Button';
import { ChoiceChip } from '@/presentation/components/ChoiceChip';
import { Field } from '@/presentation/components/Field';
import { Notice } from '@/presentation/components/Notice';
import { ScreenSection } from '@/presentation/components/Screen';
import { Card, EmptyState, SectionHeader } from '@/presentation/components/ui/Layout';
import { useTheme } from '@/presentation/theme/tokens';
import { useEffect, useState, useRef } from 'react';
import { GoalProgressService } from '@/application/goals/GoalProgressService';
import { Alert, StyleSheet, View } from 'react-native';

export function LongTermGoalsPanel({ growth }: { growth: ReturnType<typeof useGrowthData> }) {
  const theme = useTheme();
  const { store, journey, goals, error, reload } = growth;
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<GoalCategory>('ENGLISH');
  const [target, setTarget] = useState('');
  const [stageTitle,setStageTitle] = useState(''); const [stageGoal,setStageGoal] = useState<string|null>(null);
  const [saving, setSaving] = useState(false);
  const lock=useRef(false);
  const guard=usePageWriteGuard(growth.loading||!!error||saving,store,`${journey?.id}:${growth.currentPeriod?.id}`);
  const [progress, setProgress] = useState<Awaited<ReturnType<GoalProgressService['list']>>>([]);
  const [progressError, setProgressError] = useState<string | null>(null);
  useEffect(() => {
    let active = true; setProgress([]); setProgressError(null);
    if (journey) void new GoalProgressService(store).list(journey.id)
      .then(rows => { if (active) setProgress(rows); })
      .catch(error => { if (active) setProgressError(error instanceof Error ? error.message : '进展读取失败'); });
    return () => { active = false; };
  }, [store, journey?.id, goals]);

  async function submit() {
    if (!journey || lock.current) return;
    try { guard(); } catch(e){Alert.alert('无法保存',(e as Error).message);return;}
    lock.current=true;
    try {
      setSaving(true);
      await store.createLongTermGoal({
        journeyId: journey.id, title, category, startDate: todayIso(), targetDescription: target,
      });
      setTitle(''); setTarget(''); setShowForm(false);
      await reload();
    } catch (caught) {
      Alert.alert('无法创建长期目标', caught instanceof Error ? caught.message : '请稍后重试');
    } finally { lock.current=false;setSaving(false); }
  }

  async function saveStage(goalId:string) {
    if(lock.current||!growth.currentPeriod||!store.createPeriodGoal)return;
    try{guard();}catch(e){Alert.alert('未保存',(e as Error).message);return;}
    lock.current=true;setSaving(true);
    try{await store.createPeriodGoal(growth.currentPeriod.id,goalId,stageTitle);setStageGoal(null);setStageTitle('');await reload();}
    catch(e){Alert.alert('未保存',e instanceof Error?e.message:'保存失败');}
    finally{lock.current=false;setSaving(false);}
  }
  return <View>
    {error ? <Notice title="读取失败">{error}</Notice> : null}
    {progressError ? <Notice title="进展未确认">{progressError}</Notice> : null}

    <ScreenSection>
      <SectionHeader title="长期目标" subtitle={`${goals.length} 个方向`}
        action={<Button label={showForm ? '收起' : '＋ 新目标'} variant="quiet" onPress={() => setShowForm((value) => !value)} />} />
      {showForm ? <Card>
        <Field label="目标名称" value={title} onChangeText={setTitle} placeholder="例如：英语能力" maxLength={120} />
        <AppText variant="label">目标类别</AppText>
        <View style={styles.chips}>
          {GOAL_CATEGORIES.map((item) => <ChoiceChip key={item} label={GOAL_CATEGORY_LABELS[item]}
            selected={category === item} onPress={() => setCategory(item)} />)}
        </View>
        <Field label="真正想达到的状态" value={target} onChangeText={setTarget} multiline
          placeholder="描述未来能够真实做到什么，而不是一个百分比" />
        <Button label="保存长期目标" onPress={() => void submit()} loading={saving}
          disabled={growth.loading || !!error || saving || !title.trim() || !target.trim()} />
      </Card> : null}

      {goals.length ? goals.map((goal) => <Card key={goal.id}>
        <View style={styles.goalTop}>
          <AppText variant="eyebrow" style={{ color: theme.primary }}>{GOAL_CATEGORY_LABELS[goal.category]}</AppText>
          <AppText variant="caption" muted>{goal.status === 'ACTIVE' ? '持续中' : goal.status}</AppText>
        </View>
        <AppText variant="heading">{goal.title}</AppText>
        <AppText muted>{goal.targetDescription}</AppText>
        <GoalTaskAssociationDialog store={store} goal={goal} disabled={growth.loading||!!error} onSaved={reload} />
        <GoalPlanningEditor key={goal.updatedAt} goal={goal} store={store} reload={reload} disabled={growth.loading||!!error||!!progressError} />
        {growth.currentPeriod && store.createPeriodGoal ? <>
          <Button label={stageGoal===goal.id?'取消新增阶段目标':'添加当前阶段目标'} variant="quiet" disabled={saving||growth.loading||!!error} onPress={()=>{setStageGoal(stageGoal===goal.id?null:goal.id);setStageTitle('');}} />
          {stageGoal===goal.id?<><Field label="阶段目标名称" value={stageTitle} onChangeText={setStageTitle} />
            <Button label="保存阶段目标" disabled={saving||growth.loading||!!error||!stageTitle.trim()} onPress={()=>void saveStage(goal.id)} /></>:null}
        </>:null}
        {progress.filter(row => row.goal.id === goal.id).map(row => <View key={goal.id} style={{ gap: 8 }}>
          <AppText>关联任务 {row.taskCount} · 已完成 {row.completedTaskCount} · 实际分钟 {row.actualMinutes ?? '未知或记录不足'}</AppText>
          <AppText variant="label">关联阶段目标</AppText>
          {row.stages.map(stage=><AppText key={stage.id}>{stage.title} · {stage.status}</AppText>)}
          <AppText variant="label">关联任务（同一任务只出现一次）</AppText>
          {row.tasks.map(task=><AppText key={task.id}>{task.title} · {task.status==='DONE'?'已完成':task.status==='CANCELLED'?'已取消':'未完成'}</AppText>)}
          <AppText variant="label">近期真实成果</AppText>
          {!row.achievements.length ? <AppText muted>暂无关联成果，不推断目标已完成。</AppText> : null}
          {row.achievements.slice(0,5).map(item => <AppText key={item.id}>{item.title} · {item.occurredAt} · 实际 {item.actualDuration ?? '未知'} 分钟{item.result ? ' · ' + item.result : ''}</AppText>)}
          <AppText variant="caption" muted>相关阶段复盘（不是对本目标完成度的直接证明）</AppText>
          {row.periodReflections.slice(0,2).map(item => <View key={item.id}>
            <AppText>{item.startDate} — {item.endDate}</AppText>
            {item.facts.slice(0,3).map((fact,index) => <AppText key={index}>事实整理：{fact.statement} · 证据：{fact.evidence}</AppText>)}
            <AppText muted>AI 观察/推断需核对，不用于自动完成目标。</AppText>
          </View>)}
        </View>)}
      </Card>) : (
        <EmptyState title="先写下一个长期方向" body="例如英语、专业能力、职业发展或健身。具体考试只是它在某个阶段里的目标。"
          actionLabel="添加长期目标" onAction={() => setShowForm(true)} />
      )}
    </ScreenSection>
  </View>;
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  goalTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
