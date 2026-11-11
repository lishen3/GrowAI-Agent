import { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import type { GrowthStore } from '@/application/data/GrowthStore';
import type { LongTermGoal } from '@/domain/goals/types';
import { TaskGoalAssociationService } from '@/application/goals/TaskGoalAssociationService';
import { usePageWriteGuard } from '@/application/hooks/usePageWriteGuard';
import { AppText } from './AppText';
import { Button } from './Button';
import { Field } from './Field';
import { ChoiceChip } from './ChoiceChip';
import { useTheme } from '@/presentation/theme/tokens';

export function GoalTaskAssociationDialog({ store, goal, disabled, onSaved }: {
  store: GrowthStore; goal: LongTermGoal; disabled: boolean; onSaved: () => Promise<void>;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false), [search, setSearch] = useState('');
  const [tab, setTab] = useState<'all'|'scheduled'|'pending'>('all');
  const [facts, setFacts] = useState<Awaited<ReturnType<TaskGoalAssociationService['read']>> | null>(null);
  const [selected, setSelected] = useState(''), [parentId, setParentId] = useState('');
  const [confirmedWeeklyGoalChange,setConfirmedWeeklyGoalChange]=useState(false);
  const [confirmedDirectionMigration,setConfirmedDirectionMigration]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error, setError] = useState(''); const lock = useRef(false);
  const guard = usePageWriteGuard(disabled || saving || !facts || !!error || !open, store, goal.id + ':' + open);
  useEffect(() => {
    let active = true; setFacts(null); setError(''); setSelected(''); setConfirmedWeeklyGoalChange(false);setConfirmedDirectionMigration(false);
    if (open) void new TaskGoalAssociationService(store).read(goal.journeyId).then(value => { if (active) setFacts(value); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [open, store, goal.id, goal.journeyId]);
  async function save(unlink: boolean) {
    if (lock.current) return;
    try { guard(); } catch (e) { setError((e as Error).message); return; }
    const row = facts?.rows.find(r => r.task.id === selected); if (!row) return;
    lock.current = true; setSaving(true);
    try {
      await new TaskGoalAssociationService(store).assign(goal.journeyId, goal.id, row.task, unlink ? null : parentId, {confirmedWeeklyGoalChange,confirmedDirectionMigration});
      setOpen(false); await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : '关联失败，原关系保留'); }
    finally { lock.current = false; setSaving(false); }
  }
  return <>
    <Button label="关联已有任务" variant="quiet" disabled={disabled || saving} onPress={() => { setSearch(''); setTab('all'); setOpen(true); }} />
    <Modal visible={open} transparent onRequestClose={() => { if (!saving) setOpen(false); }}>
      <View style={{ flex:1, justifyContent:'center', alignItems:'center', padding:16, backgroundColor:'rgba(0,0,0,0.25)' }}>
        <ScrollView style={{ flexGrow:0, width:'100%', maxWidth:716, maxHeight:'90%', backgroundColor:theme.background, borderRadius:16 }} contentContainerStyle={{padding:16,gap:12}} keyboardShouldPersistTaps="handled">
          <AppText variant="heading">关联已有任务 · {goal.title}</AppText>
          <AppText muted>只调整目标归属，不新建任务或日程；原有时间和执行记录保留。</AppText>
          <Field label="搜索任务名称" value={search} onChangeText={setSearch} />
          <View style={{flexDirection:'row',gap:8}}>{(['all','pending','scheduled'] as const).map(value => <ChoiceChip key={value} label={value==='all'?'全部任务':value==='pending'?'待安排':'已安排'} selected={tab===value} onPress={() => setTab(value)} />)}</View>
          {!facts && !error ? <AppText>正在读取任务与日程…</AppText> : null}
          {error ? <AppText>{error}；请关闭后重新读取。</AppText> : null}
          {facts?.rows.filter(r => r.task.title.includes(search) && (tab==='all' || (tab==='scheduled')===!!r.events.length)).map(row => {
            const parents = facts.groups.find(g => g.period.id===row.period.id)?.parents.filter(p => p.longTermGoalId===goal.id && ['ACTIVE','PLANNED'].includes(p.status)) ?? [];
            return <View key={row.task.id} style={{gap:8,borderBottomWidth:1,borderColor:theme.border,paddingBottom:12}}>
              <Button label={`选择任务：${row.task.title}`} variant="quiet" disabled={disabled || saving || !!error} onPress={() => { setSelected(row.task.id); setParentId(parents.length===1?parents[0].id:''); setConfirmedWeeklyGoalChange(false);setConfirmedDirectionMigration(false); }} />
              <AppText>{row.period.name} · {row.task.status==='DONE'?'已完成':row.task.status==='CANCELLED'?'已取消':'未完成'} · {row.events.length?'已安排':'待安排'}</AppText>
              <AppText muted>当前归属：{row.goal?.title ?? (row.originalGoalId ? '原方向（已归档或不可见）' : '独立方向')}{row.parent ? ' / '+row.parent.title : '（未关联）'}</AppText>
              {row.events.map(event => <AppText key={event.id} variant="caption">{event.date} {event.startTime}–{event.endTime}</AppText>)}
              {selected===row.task.id ? <>
                {!parents.length ? <AppText>请先在“{row.period.name}”为此方向创建阶段目标。</AppText> : parents.length===1 ? <AppText>阶段目标：{parents[0].title}</AppText> : parents.map(parent => <ChoiceChip key={parent.id} label={parent.title} selected={parent.id===parentId} onPress={() => { setParentId(parent.id); setConfirmedWeeklyGoalChange(false);setConfirmedDirectionMigration(false); }} />)}
                {row.task.weeklyGoalId ? <><AppText>保留同阶段关联会保留周目标；迁移到其他阶段或解除关联会清除原周目标。</AppText><Button label={confirmedWeeklyGoalChange?'已确认周目标变更':'确认解除原周目标关联'} variant="quiet" disabled={saving||disabled} onPress={()=>setConfirmedWeeklyGoalChange(true)} /></> : null}
                {row.originalGoalId && row.originalGoalId!==goal.id ? <Button label={confirmedDirectionMigration?'已确认方向迁移':'确认迁移：'+(row.goal?.title ?? '原方向（已归档或不可见）')+' → '+goal.title} variant="secondary" disabled={saving||disabled} onPress={() => setConfirmedDirectionMigration(true)} /> : null}
                <Button label="保存关联" disabled={disabled || saving || !parentId || !!error || !!row.originalGoalId && row.originalGoalId!==goal.id && !confirmedDirectionMigration || !!row.task.weeklyGoalId && parentId!==row.parent?.id && !confirmedWeeklyGoalChange} onPress={() => void save(false)} />
                {row.originalGoalId===goal.id ? <Button label="解除关联" variant="quiet" disabled={disabled||saving||!!error||!!row.task.weeklyGoalId&&!confirmedWeeklyGoalChange} onPress={() => void save(true)} /> : null}
              </> : null}
            </View>;
          })}
          {facts && !facts.rows.some(r => r.task.title.includes(search) && (tab==='all' || (tab==='scheduled')===!!r.events.length)) ? <AppText>没有符合条件的已有任务。</AppText> : null}
          <Button label="关闭任务选择" variant="quiet" disabled={saving} onPress={() => setOpen(false)} />
        </ScrollView>
      </View>
    </Modal>
  </>;
}
