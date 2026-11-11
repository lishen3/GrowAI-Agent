import { useRef, useState } from 'react';
import type { Task, CompleteTaskInput } from '@/domain/tasks/types';
import { ScreenSection } from './Screen';
import { AppText } from './AppText';
import { Field } from './Field';
import { Button } from './Button';
import { Notice } from './Notice';
export function TaskCompletionForm({ task, disabled, onSubmit, onCancel }: {
  task: Task; disabled?: boolean; onSubmit: (input: CompleteTaskInput) => Promise<void>; onCancel: () => void;
}) {
  const [minutes, setMinutes] = useState('');
  const [result, setResult] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  async function save() {
    if (disabled || lock.current) return;
    lock.current = true; setSaving(true); setError(null);
    try {
      const actualMinutes = minutes.trim() ? Number(minutes) : undefined;
      if (actualMinutes !== undefined && (!Number.isInteger(actualMinutes) || actualMinutes < 0)) throw new Error('实际分钟必须是非负整数，或留空');
      await onSubmit({ taskId: task.id, actualMinutes, result: result.trim() || undefined, note: note.trim() || undefined });
    } catch (error) { setError(error instanceof Error ? error.message : '保存未确认，请核对记录后再操作'); }
    finally { lock.current = false; setSaving(false); }
  }
  return <ScreenSection>
    <AppText variant="heading">完成：{task.title}</AppText>
    <AppText muted>以下均可留空。实际用时不会使用预计时长代填。</AppText>
    <Field label="实际分钟（可选）" value={minutes} onChangeText={setMinutes} editable={!saving && !disabled} keyboardType="number-pad" />
    <Field label="成果（可选）" value={result} onChangeText={setResult} editable={!saving && !disabled} multiline />
    <Field label="备注（可选）" value={note} onChangeText={setNote} editable={!saving && !disabled} multiline />
    {error ? <Notice title="完成未确认">{error}</Notice> : null}
    <Button label="确认完成" loading={saving} disabled={disabled || saving} onPress={() => void save()} />
    <Button label="取消完成" variant="quiet" disabled={saving} onPress={onCancel} />
  </ScreenSection>;
}
