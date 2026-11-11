import { useCallback, useState } from 'react';
import { useFocusEffect, router } from 'expo-router';
import { View } from 'react-native';
import type { GrowthStore } from '@/application/data/GrowthStore';
import { TaskApplicationService } from '@/application/tasks/TaskApplicationService';
import { ScheduleEventApplicationService } from '@/application/scheduling/ScheduleEventApplicationService';
import type { Period } from '@/domain/periods/types';
import type { Task } from '@/domain/tasks/types';
import type { ScheduleEvent } from '@/domain/scheduling/types';
import { AppText } from './AppText';
import { Button } from './Button';
import { ChoiceChip } from './ChoiceChip';
import { Card } from './ui/Layout';
import { Notice } from './Notice';

/** Current-Period overview; writes stay in the existing application services. */
export function TaskOverview({ store, period, revision, disabled, onSchedule, onDelete, deleteConfirmation }: {
  store: GrowthStore; period: Period; revision: number; disabled: boolean; onSchedule: (task: Task) => void; onDelete?: (task: Task) => void;
  deleteConfirmation?: { taskId: string; error: string | null; onConfirm: () => void; onCancel: () => void };
}) {
  const [tab, setTab] = useState<'scheduled' | 'pending'>('pending');
  const [data, setData] = useState<{ store: GrowthStore; periodId: string; tasks: Task[]; events: ScheduleEvent[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true; setLoading(true); setError(null);
    const read = async () => {
      try {
        if (!store.scheduleEvents) throw new Error('当前数据源不能读取日程');
        const [tasks, events] = await Promise.all([
          new TaskApplicationService(store).listTasks({ periodId: period.id }),
          new ScheduleEventApplicationService(store.scheduleEvents, store, store.courses).queryByDateRange({
            periodId: period.id, startDate: period.startDate, endDate: period.endDate }),
        ]);
        if (active) setData({ store, periodId: period.id, tasks: [...new Map(tasks.filter(task => task.periodId === period.id).map(task => [task.id, task])).values()],
          events: [...new Map(events.filter(event => event.periodId === period.id && event.taskId !== null).map(event => [event.id, event])).values()] });
      } catch (caught) { if (active) setError(caught instanceof Error ? caught.message : '任务总览读取失败'); }
      finally { if (active) setLoading(false); }
    }; void read();
    return () => { active = false; };
  }, [store, period.id, period.startDate, period.endDate, revision, retry]));
  const visible = data?.store === store && data?.periodId === period.id ? data : null;
  const assigned = new Set(visible?.events.map(event => event.taskId));
  const tasks = visible?.tasks ?? [];
  const scheduled = tasks.filter(task => assigned.has(task.id));
  const pending = tasks.filter(task => !assigned.has(task.id));
  const shown = tab === 'scheduled' ? scheduled : pending;
  const titleCounts = new Map<string, number>();
  for (const task of tasks) titleCounts.set(task.title.trim(), (titleCounts.get(task.title.trim()) ?? 0) + 1);
  return <View style={{ gap: 12 }}>
    <AppText variant="caption" muted>待安排是还没有时间块的任务；已安排包含过去和未来的安排，同一任务只显示一次，可以再次安排。安排到哪一天，就在那一天的待办中显示。</AppText>
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <ChoiceChip label={`待安排的任务 · ${pending.length}`} selected={tab === 'pending'} onPress={() => setTab('pending')} />
      <ChoiceChip label={`已安排的任务 · ${scheduled.length}`} selected={tab === 'scheduled'} onPress={() => setTab('scheduled')} />
    </View>
    {loading ? <AppText muted>正在读取任务总览…</AppText> : null}
    {error ? <View><AppText>{error}。刷新成功前暂不能操作。</AppText><Button label="重新读取任务总览" variant="quiet" onPress={() => setRetry(value => value + 1)} /></View> : null}
    {!loading && !error && !shown.length ? <AppText muted>{tab === 'pending' ? '暂无待安排任务，可用下方按钮添加。' : '还没有已安排的任务。'}</AppText> : null}
    {shown.map(task => <Card key={task.id}>
      <AppText variant="label">{task.title}{task.status === 'DONE' ? ' · 已完成' : task.status === 'CANCELLED' ? ' · 已取消' : ''}</AppText>
      {(titleCounts.get(task.title.trim()) ?? 0) > 1 && task.createdAt ? <AppText variant="caption" muted>
        创建于 {new Date(task.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
      </AppText> : null}
      {tab === 'pending' ? <AppText variant="caption" muted>待安排 · 请到计划页安排时间</AppText> : <AppText variant="caption" muted>已安排</AppText>}
      {tab === 'scheduled' ? visible?.events.filter(event => event.taskId === task.id)
        .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)).map(event => <View key={event.id}>
          <AppText variant="caption" muted>{event.date} {event.startTime}–{event.endTime}</AppText>
          <Button label="查看日程" variant="quiet" disabled={disabled || loading || !!error}
            onPress={() => router.push({ pathname: '/plan', params: { eventId: event.id, date: event.date } })} />
        </View>) : null}
      {!['DONE', 'CANCELLED'].includes(task.status) ? <Button label={tab === 'scheduled' ? '再次安排时间' : '去安排时间'} disabled={disabled || loading || !!error}
        onPress={() => onSchedule(task)} /> : <AppText muted>历史任务已保留，不再安排新时间。</AppText>}
      {onDelete && store.deleteUnscheduledTask ? <Button label={`删除任务：${task.title}`} variant="quiet" disabled={disabled || loading || !!error}
        onPress={() => onDelete(task)} /> : null}
      {deleteConfirmation?.taskId === task.id ? <View style={{ gap: 8 }}>
        <Notice title={`删除“${task.title}”？`}>此操作不可逆；存在时间块、执行记录等关联时会拒绝删除，原任务会保留。</Notice>
        {deleteConfirmation.error ? <Notice title="删除未完成">{deleteConfirmation.error}</Notice> : null}
        <Button label="确认删除任务" disabled={disabled || loading || !!error} onPress={deleteConfirmation.onConfirm} />
        <Button label="取消删除" variant="quiet" disabled={disabled} onPress={deleteConfirmation.onCancel} />
      </View> : null}
    </Card>)}
  </View>;
}
