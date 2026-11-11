import type { GrowthStore } from '@/application/data/GrowthStore';
import { useRef, useState } from 'react';
import type { Task } from '@/domain/tasks/types';
import type { Period } from '@/domain/periods/types';
import { userScheduleEvent, type CreateScheduleEvent, type ScheduleEvent, type ScheduleEventChanges } from '@/domain/scheduling/types';
import { AppText } from '@/presentation/components/AppText';
import { Field } from '@/presentation/components/Field';
import { Button } from '@/presentation/components/Button';
import { Notice } from '@/presentation/components/Notice';
import { ScreenSection } from '@/presentation/components/Screen';
import { useCreationDraft } from '@/application/hooks/useCreationDraft';

export function buildScheduleEventInput(task: Task, period: Period, date: string, startTime: string, endTime: string): CreateScheduleEvent {
  const { id: _id, ...input } = userScheduleEvent({ id: 'validation-only', taskId: task.id, periodId: period.id,
    type: 'TASK', source: 'USER', title: task.title, date, startTime, endTime });
  if (task.periodId !== period.id) throw new Error('任务不属于当前阶段，请重新读取');
  if (date < period.startDate || date > period.endDate) throw new Error('日期必须在当前阶段范围内');
  return input;
}

export function buildScheduleEventChanges(event: ScheduleEvent, period: Period, title: string, date: string, startTime: string, endTime: string): ScheduleEventChanges {
  const updated = userScheduleEvent({ ...event, title, date, startTime, endTime });
  if (event.periodId !== period.id) throw new Error('安排不属于当前阶段');
  if (date < period.startDate || date > period.endDate) throw new Error('日期必须在当前阶段范围内');
  return { title: updated.title, date: updated.date, startTime: updated.startTime, endTime: updated.endTime };
}

type FormProps = { store?: GrowthStore; disabled?: boolean; period: Period; onCancel: () => void;
  defaultSlot?: { date: string; startTime: string; endTime: string } } & (
  { mode?: 'create'; task: Task; onSubmit: (input: CreateScheduleEvent) => Promise<void> }
  | { mode: 'edit'; event: ScheduleEvent; onSubmit: (changes: ScheduleEventChanges) => Promise<void> });

export function ScheduleEventForm(props: FormProps) {
  const { period, onCancel } = props;
  const event = props.mode === 'edit' ? props.event : null;
  const [draft, setDraft, discardDraft] = useCreationDraft('task-time-create',
    props.mode !== 'edit' ? JSON.stringify([period.id, props.task.id, props.defaultSlot]) : null,
    { title: event?.title ?? '', date: event?.date ?? props.defaultSlot?.date ?? '',
      startTime: event?.startTime ?? props.defaultSlot?.startTime ?? '', endTime: event?.endTime ?? props.defaultSlot?.endTime ?? '' });
  const { title, date, startTime, endTime } = draft;
  const setTitle = (title: string) => setDraft(value => ({ ...value, title }));
  const setDate = (date: string) => setDraft(value => ({ ...value, date }));
  const setStartTime = (startTime: string) => setDraft(value => ({ ...value, startTime }));
  const setEndTime = (endTime: string) => setDraft(value => ({ ...value, endTime }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  async function submit() {
    if (props.disabled || lock.current) return;
    lock.current = true; setSaving(true); setError(null);
    try {
      if (props.mode === 'edit') await props.onSubmit(buildScheduleEventChanges(props.event, period, title, date, startTime, endTime));
      else await props.onSubmit(buildScheduleEventInput(props.task, period, date, startTime, endTime));
      if (props.mode !== 'edit') discardDraft();
    }
    catch (caught) {
      const issues = (caught as { issues?: { message: string }[] })?.issues;
      setError(issues?.map((issue) => issue.message).join('；') ?? (caught instanceof Error ? caught.message : '创建失败，请检查输入'));
    } finally { lock.current = false; setSaving(false); }
  }
  return <ScreenSection>
    <AppText variant="heading">{event ? `编辑安排 · ${event.title}` : `安排时间 · ${props.mode !== 'edit' ? props.task.title : ''}`}</AppText>
    <AppText variant="caption" muted>阶段：{period.startDate} — {period.endDate}。请明确填写同一天内的时段，不自动安排时间；本页只显示当前周。</AppText>
    {event ? <Field label="安排标题" value={title} onChangeText={setTitle} editable={!props.disabled && !saving} /> : null}
    <Field label="日期（YYYY-MM-DD）" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" maxLength={10} editable={!props.disabled && !saving} />
    <Field label="开始时间（HH:mm）" value={startTime} onChangeText={setStartTime} placeholder="HH:mm" maxLength={5} editable={!props.disabled && !saving} />
    <Field label="结束时间（HH:mm）" value={endTime} onChangeText={setEndTime} placeholder="HH:mm" maxLength={5} editable={!props.disabled && !saving} />
    {error ? <Notice title={event ? '未能保存安排' : '未能创建安排'}>{error}</Notice> : null}
    <Button label={event ? '保存修改' : '创建安排'} loading={saving} disabled={props.disabled || saving} onPress={() => void submit()} />
    <Button label={event ? '取消编辑' : '取消创建'} variant="quiet" disabled={saving} onPress={() => { if (!lock.current) { discardDraft(); onCancel(); } }} />
  </ScreenSection>;
}
