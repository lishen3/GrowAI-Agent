import { usePageWriteGuard } from '@/application/hooks/usePageWriteGuard';
import { useState } from 'react';
import { View } from 'react-native';
import type { GrowthStore } from '@/application/data/GrowthStore';
import type { LongTermGoal } from '@/domain/goals/types';
import { goalDeadline, goalProgress, type GoalPlanning } from '@/domain/goals/progress';
import { todayIso } from '@/shared/date';
import { AppText } from './AppText';
import { Button } from './Button';
import { Field } from './Field';

export function GoalPlanningEditor({ goal, store, reload, disabled = false }: { goal: LongTermGoal; store: GrowthStore; reload: () => Promise<void>; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<GoalPlanning>(goal.planning ?? { endDate: null, mode: 'MANUAL', manualPercent: 0, milestones: [] });
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const guard = usePageWriteGuard(disabled || saving,store,goal.id + ':' + goal.updatedAt);
  const progress = goalProgress(goal.planning);
  async function save() {
    if (!store.updateGoalPlanning) return;
    try { guard(); } catch(e) { setError((e as Error).message); return; }
    setSaving(true); setError('');
    try { await store.updateGoalPlanning(goal.journeyId, goal.id, value, goal.updatedAt); await reload(); setEditing(false); }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败'); } finally { setSaving(false); }
  }
  return <View style={{ gap: 8 }}>
    <AppText>{goal.planning?.endDate ?? '无目标日期'} · {goal.status === 'COMPLETED' ? '已完成' : goalDeadline(goal.planning?.endDate, todayIso()).label}</AppText>
    <AppText>{progress ? `${Math.round(progress.percent)}% · ${progress.source}` : '尚未评估进度'}</AppText>
    {progress ? <View accessibilityLabel={`目标进度 ${Math.round(progress.percent)}%`} style={{ height: 6, backgroundColor: '#deded5', borderRadius: 3 }}><View style={{ width: `${progress.percent}%`, height: 6, backgroundColor: '#326b50', borderRadius: 3 }} /></View> : null}
    {!editing ? <Button label="设置目标日期与进度" disabled={disabled} variant="quiet" onPress={() => { setValue(goal.planning ?? { endDate: null, mode: 'MANUAL', manualPercent: 0, milestones: [] }); setEditing(true); }} /> : <>
      <Field label="目标结束日期（可选）" value={value.endDate ?? ''} onChangeText={text => setValue({ ...value, endDate: text || null })} placeholder="YYYY-MM-DD" />
      <Button label={value.mode === 'MANUAL' ? '当前：手动评估，切换为里程碑' : '当前：里程碑，切换为手动评估'} variant="quiet" onPress={() => setValue({ ...value, mode: value.mode === 'MANUAL' ? 'MILESTONE' : 'MANUAL' })} />
      {value.mode === 'MANUAL' ? <Field label="手动进度（0–100）" value={String(value.manualPercent)} keyboardType="numeric" onChangeText={text => setValue({ ...value, manualPercent: Number(text) })} /> : <>
        {value.milestones.map((row, index) => <View key={row.id} style={{ gap: 8 }}>
          <Field label="里程碑名称" value={row.title} onChangeText={title => setValue({ ...value, milestones: value.milestones.map((m,i) => i === index ? { ...m, title } : m) })} />
          <Field label="权重" value={String(row.weight)} keyboardType="numeric" onChangeText={weight => setValue({ ...value, milestones: value.milestones.map((m,i) => i === index ? { ...m, weight: Number(weight) } : m) })} />
          <Button label={row.completed ? '已完成里程碑，点击撤销' : '标记里程碑完成'} variant="quiet" onPress={() => setValue({ ...value, milestones: value.milestones.map((m,i) => i === index ? { ...m, completed: !m.completed } : m) })} />
          <Button label="移除此里程碑" variant="quiet" onPress={() => setValue({ ...value, milestones: value.milestones.filter(m => m.id !== row.id) })} />
        </View>)}
        <Button label="添加里程碑" variant="quiet" onPress={() => setValue({ ...value, milestones: [...value.milestones, { id: 'milestone-' + Date.now() + '-' + value.milestones.length, title: '', weight: 1, completed: false }] })} />
      </>}
      {error ? <AppText>{error}</AppText> : null}
      <Button label="保存目标规划" disabled={saving||disabled} onPress={() => void save()} />
      <Button label="取消修改" disabled={saving||disabled} variant="quiet" onPress={() => setEditing(false)} />
    </>}
  </View>;
}
