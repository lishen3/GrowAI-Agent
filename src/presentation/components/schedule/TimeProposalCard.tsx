import { router } from 'expo-router';
import { useLayoutEffect, useRef, useState } from 'react';
import type { TimeOperation, TimeOperationReference } from '@/domain/replan/timeOperation';
import type { TimeMoveResult, TimeReplanService } from '@/application/replan/TimeReplanService';
import { usePageWriteGuard } from '@/application/hooks/usePageWriteGuard';
import { todayIso } from '@/shared/date';
import { AppText } from '../AppText';
import { Button } from '../Button';
import { Notice } from '../Notice';

export function TimeProposalCard({ reference, service, reason, blocked, store, scope, onSaved, onCancelled, actionLock }: {
  reference: TimeOperationReference; service: TimeReplanService; reason: string;
  blocked: boolean; store: object; scope: string; onSaved: () => Promise<void>; onCancelled?: () => void; actionLock?: { current: boolean };
}) {
  const [record, setRecord] = useState<TimeOperation | null>(null);
  const [result, setResult] = useState<TimeMoveResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const generation = useRef(0);
  const guard = usePageWriteGuard(blocked || loading || saving, store, scope);

  function readback(row: TimeOperation, value: Awaited<ReturnType<TimeReplanService['reconcile']>>): TimeMoveResult {
    return { ...value, status: value.status === 'SUCCESS' ? row.operationType === 'CREATE_TASK_TIME' ? 'SCHEDULED' : 'MOVED' : value.status,
      message: value.status === 'SUCCESS' ? '已核验保存结果' : '保存结果需要只读核验，请勿重复执行' };
  }
  useLayoutEffect(() => {
    let current = true; generation.current++; lock.current = false;
    setLoading(true); setSaving(false); setError(null); setResult(null); setRecord(null);
    void (async () => {
      try {
        const row = await service.inspectOperation(reference);
        if (!current) return;
        setRecord(row);
        if (row.status === 'COMMITTED') {
          const value = await service.reconcile(reference);
          if (current) setResult(readback(row, value));
        }
      } catch (caught) { if (current) setError(caught instanceof Error ? caught.message : '建议读取失败'); }
      finally { if (current) setLoading(false); }
    })();
    return () => { current = false; generation.current++; };
  }, [service, reference.operationId, reference.contentDigest, store, scope]);

  async function confirm() {
    if (lock.current || actionLock?.current) return;
    try { guard(); } catch (caught) { setError((caught as Error).message); return; }
    if (!record || record.status !== 'PENDING' || result) return;
    const token = generation.current;
    lock.current = true; if(actionLock)actionLock.current=true; setSaving(true); setError(null);
    try {
      const value = record.operationType === 'CREATE_AND_SCHEDULE' ? await service.confirmNewTask(reference)
        : record.operationType === 'CREATE_TASK_TIME'
        ? await service.confirmSchedule(reference, { startDate: record.scope.weekStart, endDate: record.scope.weekEnd })
        : await service.confirm(reference);
      if (token !== generation.current) return;
      setResult(value);
      if ((value.status === 'SCHEDULED' || value.status === 'MOVED') && value.writeOutcome === 'COMMITTED' && value.readbackVerified) {
        try { await onSaved(); } catch { if (token === generation.current) setError('安排已保存，但列表刷新失败，请重新读取页面'); }
      }
    } catch { if (token === generation.current) setResult({ status: 'NEEDS_RECONCILIATION', message: '执行结果尚未确认，请只读核验，不要重新执行', writeOutcome: 'UNKNOWN' }); }
    finally { if (token === generation.current) { setSaving(false); lock.current = false; } if(actionLock)actionLock.current=false; }
  }
  async function reconcile() {
    if (!record || lock.current || actionLock?.current) return;
    const token = generation.current;
    lock.current = true; if(actionLock)actionLock.current=true; setSaving(true);
    try {
      const value = await service.reconcile(reference);
      if (token === generation.current) setResult(readback(record, value));
    } catch { if (token === generation.current) setError('只读核验失败，未重新执行，请稍后核对日历'); }
    finally { if (token === generation.current) { setSaving(false); lock.current = false; } if(actionLock)actionLock.current=false; }
  }
  async function cancel() {
    if (lock.current || actionLock?.current || !record || record.status !== 'PENDING') return;
    try { guard(); } catch (caught) { setError((caught as Error).message); return; }
    const token = generation.current;
    lock.current = true; if(actionLock)actionLock.current=true; setSaving(true); setError(null);
    try { const row = await service.cancel(reference); if (token === generation.current) { setRecord(row); onCancelled?.(); } }
    catch (caught) { if (token === generation.current) setError(caught instanceof Error ? caught.message : '取消失败，请只读核验'); }
    finally { if (token === generation.current) { setSaving(false); lock.current = false; } if(actionLock)actionLock.current=false; }
  }
  if (loading) return <AppText muted>正在读取变更摘要…</AppText>;
  const committed = result?.writeOutcome === 'COMMITTED' && result.readbackVerified;
  const pending = record?.status === 'PENDING' && !result;
  return <>
    {record ? <>
      <AppText variant="caption" muted>{record.operationType === 'CREATE_AND_SCHEDULE' ? '建议新建任务' : record.operationType === 'CREATE_TASK_TIME' ? '建议新增时间安排' : '建议移动时间安排'}</AppText>
      <AppText variant="heading">{record.expectedTaskFacts.title} · {record.after.date} {record.after.startTime}–{record.after.endTime}</AppText>
      {record.expectedBefore ? <AppText muted>原时间：{record.expectedBefore.date} {record.expectedBefore.startTime}–{record.expectedBefore.endTime}</AppText> : null}
      <AppText variant="caption">时长：{(Number(record.after.endTime.slice(0, 2)) - Number(record.after.startTime.slice(0, 2))) * 60
        + Number(record.after.endTime.slice(3)) - Number(record.after.startTime.slice(3))} 分钟</AppText>
      <AppText muted>理由：{reason}</AppText>
    </> : null}
    {error ? <Notice title="请核对安排状态">{error}</Notice> : null}
    {pending ? <Button label={record?.operationType === 'CREATE_AND_SCHEDULE' ? '确认并添加' : '确认执行排程'} loading={saving} disabled={blocked || saving || !!error} onPress={() => void confirm()} /> : null}
    {pending && service.canCancel ? <Button label="取消此建议" variant="quiet" disabled={blocked || saving} onPress={() => void cancel()} /> : null}
    {committed ? <>
      <AppText accessibilityLiveRegion="polite">{record?.operationType === 'MOVE_TASK_TIME' ? '已调整' : '已添加'} · {record?.after.date === todayIso()
        ? '已同步至日历和今日待办' : '已同步至日历，将在对应日期的待办中显示'}</AppText>
      {record && <Button label="查看当天日历" variant="secondary" onPress={() => router.push({
        pathname: '/plan', params: { date: record.after.date, eventId: record.eventId, periodId: record.scope.periodId },
      })} />}
    </> : null}
    {result && !committed ? <Notice title={result.status === 'NEEDS_RECONCILIATION' ? '需要核验，暂勿重复操作' : '未保存安排'}>
      {result.message.includes('TIME_CONFLICT') ? '该时段已有安排，请重新生成建议。未保存此次变更。' : result.message}
    </Notice> : null}
    {result?.status === 'NEEDS_RECONCILIATION' || record?.status === 'COMMITTED' && !committed ? <Button label="只读核验" variant="secondary" loading={saving} disabled={saving || blocked} onPress={() => void reconcile()} /> : null}
    {record && !pending && !committed && !result ? <AppText muted>此建议已关闭，请重新生成。</AppText> : null}
  </>;
}
