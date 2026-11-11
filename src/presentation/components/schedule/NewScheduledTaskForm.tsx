import { CategoryPicker } from '../CategoryPicker';
import { ChoiceChip } from '../ChoiceChip';
import { legacyCategoryForId } from '@/domain/categories/types';
import { calendarMinutes, calendarTime } from '@/domain/scheduling/calendarInteraction';
import { useRef, useState } from 'react';
import type { CreateTaskInput } from '@/domain/tasks/types';
import type { ScheduleEvent } from '@/domain/scheduling/types';
import type { ScheduledTaskResult } from '@/application/scheduling/CreateScheduledTaskService';
import { AppText } from '@/presentation/components/AppText';
import { Field } from '@/presentation/components/Field';
import { Button } from '@/presentation/components/Button';
import { Notice } from '@/presentation/components/Notice';
import { ScreenSection } from '@/presentation/components/Screen';
import type { GrowthStore } from '@/application/data/GrowthStore';
import type { Period } from '@/domain/periods/types';
import { createId } from '@/shared/id';
import { useCreationDraft } from '@/application/hooks/useCreationDraft';

type Slot = Pick<ScheduleEvent, 'date' | 'startTime' | 'endTime'>;
export function NewScheduledTaskForm({ slot, onSubmit, onCancel, defaultTitle = '', converting = false, disabled = false, goalContext }: { slot: Slot; disabled?: boolean; onCancel: () => void; defaultTitle?: string; converting?: boolean; goalContext?: { store: GrowthStore; period: Period };
  onSubmit: (input: Omit<CreateTaskInput, 'periodId' | 'plannedDate'>, slot: Slot, requestId?: string) => Promise<ScheduledTaskResult> }) {
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const [draft, setDraft, discardDraft] = useCreationDraft('scheduled-task-create',
    !converting && goalContext ? JSON.stringify([goalContext.period.id, slot]) : null,
    { title: defaultTitle, date: slot.date, startTime: slot.startTime, endTime: slot.endTime,
      estimated: String(minutes(slot.endTime) - minutes(slot.startTime)), duration: String(minutes(slot.endTime)-minutes(slot.startTime)), categoryId:'CUSTOM', priority:'B', requestId: createId('manual') });
  const { title, date, startTime, endTime, estimated } = draft;
  const setTitle = (title: string) => setDraft(value => ({ ...value, title }));
  const setDate = (date: string) => setDraft(value => ({ ...value, date }));
  const setStartTime = (startTime: string) => setDraft(value => ({ ...value, startTime, endTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ? calendarTime(calendarMinutes(startTime)+Number(value.duration)) : value.endTime }));
  const setEndTime = (endTime: string) => setDraft(value => ({ ...value, endTime, duration: String(calendarMinutes(endTime)-calendarMinutes(value.startTime)) }));
  const setEstimated = (estimated: string) => setDraft(value => ({ ...value, estimated }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState<string | null>(null);
  const lock = useRef(false);
  const [showGoalLinks, setShowGoalLinks] = useState(false);
  async function submit() {
    if (disabled || lock.current || partial) return;
    lock.current = true; setSaving(true); setError(null);
    try {
      if (!estimated.trim() || !Number.isInteger(Number(estimated)) || Number(estimated) < 0) throw new Error('预计分钟必须是非负整数');
      const result = await onSubmit({ title, category: legacyCategoryForId(draft.categoryId), priority: draft.priority as CreateTaskInput['priority'], estimatedMinutes: Number(estimated), ...(goalContext ? { categoryId: draft.categoryId } : {}), periodGoalId: null, weeklyGoalId: null }, { date, startTime, endTime }, draft.requestId);
      discardDraft();
      if (!result.event) setPartial(`任务「${result.task.title}」已创建，但时间块保存未确认：${result.error}。请先检查时间表，再到智能体选择已有任务安排，不要重复创建。`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '创建失败，请检查输入'); }
    finally { lock.current = false; setSaving(false); }
  }
  return <ScreenSection>
    <AppText variant="heading">{converting ? '将临时日程转为任务' : '新建待办任务'}</AppText>
    <AppText muted>创建真实任务并安排时间；预计投入与日历时段可以不同。</AppText>
    <Field label="任务名称" value={title} onChangeText={setTitle} editable={!disabled && !saving && !partial} />
    <Field label="预计分钟" value={estimated} onChangeText={setEstimated} keyboardType="number-pad" editable={!disabled && !saving && !partial} />
    <Field label="日期（YYYY-MM-DD）" value={date} onChangeText={setDate} editable={!disabled && !saving && !partial && !converting} />
    <Field label="开始时间（HH:mm）" value={startTime} onChangeText={setStartTime} editable={!disabled && !saving && !partial && !converting} />
    {!converting ? <Field label="本次安排分钟（与任务预计分钟独立）" value={draft.duration} keyboardType="number-pad" editable={!disabled && !saving} onChangeText={duration=>setDraft(value=>({...value,duration,endTime:/^\d+$/.test(duration)?calendarTime(calendarMinutes(value.startTime)+Number(duration)):value.endTime}))} />:null}
    <Field label="结束时间（HH:mm）" value={endTime} onChangeText={setEndTime} editable={!disabled && !saving && !partial && !converting} />
    {goalContext ? <>
      <Button label={showGoalLinks ? '收起高级设置' : '高级设置：分类与优先级'} variant="quiet"
        disabled={disabled || saving || !!partial} onPress={() => setShowGoalLinks(!showGoalLinks)} />
      {showGoalLinks ? <>
        <AppText variant="label">任务优先级</AppText>
        {['S','A','B','C'].map(priority=><ChoiceChip key={priority} label={priority} selected={draft.priority===priority} onPress={()=>!disabled&&!saving&&setDraft(value=>({...value,priority}))} />)}
        <CategoryPicker store={goalContext.store} journeyId={goalContext.period.journeyId} value={draft.categoryId} disabled={disabled||saving} onChange={categoryId=>setDraft(value=>({...value,categoryId}))} />
</> : null}
    </> : null}
    {error ? <Notice title="创建失败">{error}</Notice> : null}
    {partial ? <Notice title="部分成功，任务已保留">{partial}</Notice> : null}
    <Button label="创建任务并安排" loading={saving} disabled={disabled || saving || !!partial || !title.trim()} onPress={() => void submit()} />
    <Button label={partial ? '关闭，稍后安排' : '取消'} variant="quiet" disabled={saving} onPress={() => { discardDraft(); onCancel(); }} />
  </ScreenSection>;
}
