import { useRef, useState } from 'react';
import type { ScheduleEvent } from '@/domain/scheduling/types';
import { AppText } from '@/presentation/components/AppText';
import { Button } from '@/presentation/components/Button';
import { Notice } from '@/presentation/components/Notice';
import { ScreenSection } from '@/presentation/components/Screen';

export function ScheduleEventDeleteConfirmation({ event, onConfirm, onCancel, disabled = false }: {
  disabled?: boolean; event: ScheduleEvent; onConfirm: () => Promise<void>; onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  async function confirm() {
    if (disabled || lock.current) return;
    lock.current = true; setSaving(true); setError(null);
    try { await onConfirm(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '删除失败，请重新读取'); }
    finally { lock.current = false; setSaving(false); }
  }
  return <ScreenSection>
    <AppText variant="heading">确认删除该安排？</AppText>
    <AppText>{event.title}</AppText>
    <AppText variant="caption">{event.date} · {event.startTime} – {event.endTime}</AppText>
    <AppText muted>仅删除这个时间安排，不删除任务，不修改任务日期或完成记录。</AppText>
    {error ? <Notice title="未能删除安排">{error}</Notice> : null}
    <Button label="确认删除" disabled={disabled || saving} loading={saving} onPress={() => void confirm()} />
    <Button label="取消删除" variant="quiet" disabled={saving} onPress={() => { if (!lock.current) onCancel(); }} />
  </ScreenSection>;
}
