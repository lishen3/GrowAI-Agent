import type { GrowthStore } from '@/application/data/GrowthStore';
import { useRef, useState } from 'react';
import type { Period } from '@/domain/periods/types';
import { userScheduleEvent, type CreateScheduleEvent } from '@/domain/scheduling/types';
import { AppText } from '@/presentation/components/AppText';
import { Field } from '@/presentation/components/Field';
import { Button } from '@/presentation/components/Button';
import { Notice } from '@/presentation/components/Notice';
import { ScreenSection } from '@/presentation/components/Screen';
import { useCreationDraft } from '@/application/hooks/useCreationDraft';

export function buildPersonalEventInput(period: Period, title: string, date: string,
  startTime: string, endTime: string): CreateScheduleEvent {
  const event = userScheduleEvent({
    id: 'validation-only', periodId: period.id, taskId: null, type: 'PERSONAL', source: 'USER',
    title, date, startTime, endTime,
  });
  if (date < period.startDate || date > period.endDate) throw new Error('日期必须在当前阶段范围内');
  return {
    periodId: period.id, taskId: null, type: 'PERSONAL', source: 'USER',
    title: event.title, date: event.date, startTime: event.startTime, endTime: event.endTime,
  };
}

export function PersonalEventForm({ period, defaultDate, defaultStart = '19:00', defaultEnd = '20:00',
  onCancel, onSubmit, disabled = false, store }: {
  disabled?: boolean;
  store?: GrowthStore;
  period: Period;
  defaultDate: string;
  defaultStart?: string;
  defaultEnd?: string;
  onCancel: () => void;
  onSubmit: (input: CreateScheduleEvent) => Promise<void>;
}) {
  const [draft, setDraft, discardDraft] = useCreationDraft('personal-create',
    JSON.stringify([period.id, defaultDate, defaultStart, defaultEnd]),
    { title: '', date: defaultDate, startTime: defaultStart, endTime: defaultEnd });
  const { title, date, startTime, endTime } = draft;
  const setTitle = (title: string) => setDraft(value => ({ ...value, title }));
  const setDate = (date: string) => setDraft(value => ({ ...value, date }));
  const setStartTime = (startTime: string) => setDraft(value => ({ ...value, startTime }));
  const setEndTime = (endTime: string) => setDraft(value => ({ ...value, endTime }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);

  async function submit() {
    if (disabled || lock.current) return;
    lock.current = true; setSaving(true); setError(null);
    try {
      await onSubmit({ ...buildPersonalEventInput(period, title, date, startTime, endTime), ...(store ? { categoryId: 'CUSTOM' } : {}) });
      discardDraft();
    } catch (caught) {
      const issues = (caught as { issues?: { message: string }[] })?.issues;
      setError(issues?.map((issue) => issue.message).join('；')
        ?? (caught instanceof Error ? caught.message : '保存失败，请检查输入'));
    } finally { lock.current = false; setSaving(false); }
  }

  return <ScreenSection>
    <AppText variant="heading">新建临时日程</AppText>
    <AppText variant="caption" muted>临时日程不生成长期任务，仅占用日历时间（如：拿快递、看医生）。</AppText>
    <Field label="安排名称" value={title} onChangeText={setTitle} placeholder="例如：拿快递、看医生" maxLength={60} editable={!disabled && !saving} />
    <Field label="日期" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" maxLength={10} editable={!disabled && !saving} />
    <Field label="开始时间" value={startTime} onChangeText={setStartTime} placeholder="HH:mm" maxLength={5} editable={!disabled && !saving} />
    <Field label="结束时间" value={endTime} onChangeText={setEndTime} placeholder="HH:mm" maxLength={5} editable={!disabled && !saving} />
    {error ? <Notice title="未能保存临时日程">{error}</Notice> : null}
    <Button label="保存临时日程" loading={saving} disabled={disabled || saving || !title.trim()} onPress={() => void submit()} />
    <Button label="取消" variant="quiet" disabled={saving} onPress={() => { discardDraft(); onCancel(); }} />
  </ScreenSection>;
}
