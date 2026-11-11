import { isTimeBlockAdjustable } from '@/domain/replan/timeRuntime';
import { addDays, addMonths, parseISO, startOfMonth } from 'date-fns';
import { useRef } from 'react';
import { useCalendarMonth } from '@/application/hooks/useCalendarMonth';
import { MonthlyScheduleBoard } from '@/presentation/components/schedule/MonthlyScheduleBoard';
import { CalendarTaskDialog } from '@/presentation/components/schedule/CalendarTaskDialog';
import { View, StyleSheet, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useGrowthData } from '@/application/hooks/useGrowthData';
import { useWeeklyPlan } from '@/application/hooks/useWeeklyPlan';
import { useCategories } from '@/application/hooks/useCategories';
import { usePageWriteGuard } from '@/application/hooks/usePageWriteGuard';
import { useCreationDraft } from '@/application/hooks/useCreationDraft';
import { Screen, ScreenSection } from '@/presentation/components/Screen';
import { PageHeader } from '@/presentation/components/ui/Layout';
import { AppText } from '@/presentation/components/AppText';
import { Button } from '@/presentation/components/Button';
import { ChoiceChip } from '@/presentation/components/ChoiceChip';
import { Notice } from '@/presentation/components/Notice';
import { useTheme } from '@/presentation/theme/tokens';
import { ScheduleEventForm } from '@/components/scheduling/ScheduleEventForm';
import { ScheduleEventDeleteConfirmation } from '@/components/scheduling/ScheduleEventDeleteConfirmation';
import { WeeklyScheduleBoard } from '@/presentation/components/schedule/WeeklyScheduleBoard';
import { PersonalEventForm } from '@/presentation/components/schedule/PersonalEventForm';
import { NewScheduledTaskForm } from '@/presentation/components/schedule/NewScheduledTaskForm';
import { CreateScheduledTaskService } from '@/application/scheduling/CreateScheduledTaskService';
import { CourseImportPanel } from '@/presentation/components/schedule/CourseImportPanel';
import { CourseManagerPanel } from '@/presentation/components/schedule/CourseManagerPanel';
import { calculatePeriodWeek, todayIso } from '@/shared/date';
import type { ScheduleEvent } from '@/domain/scheduling/types';
import type { Task } from '@/domain/tasks/types';

const TYPE_LABELS: Record<ScheduleEvent['type'], string> = {
  COURSE: '固定课程', TASK: '任务', PERSONAL: '临时日程', AI_ADJUSTMENT: 'AI 调整',
};
const SOURCE_LABELS: Record<ScheduleEvent['source'], string> = {
  USER: '用户', SYSTEM: '系统', AI: 'AI',
};

export default function PlanScreen() {
  const route = useLocalSearchParams<{ create?: string; eventId?: string; date?: string; taskId?: string; periodId?: string }>();
  const growth = useGrowthData();
  const [weekOffset, setWeekOffset] = useState(0);
  const plan = useWeeklyPlan(growth.store, growth.currentPeriod, weekOffset);
  const [navigation, setNavigation] = useCreationDraft('calendar-navigation', growth.currentPeriod?.id ?? null, { selectedDate: todayIso(), viewMode: 'week' });
  const monthly = useCalendarMonth(growth.store,growth.currentPeriod,navigation.selectedDate,navigation.viewMode==='month');
  const [calendarIntent,setCalendarIntent,discardCalendarIntent] = useCreationDraft('calendar-create-intent',growth.currentPeriod?.id ?? null,{open:false as boolean,date:'',startTime:'09:00',endTime:'10:00',taskId:''});
  const calendarSlot=calendarIntent.open?{date:calendarIntent.date,startTime:calendarIntent.startTime,endTime:calendarIntent.endTime,taskId:calendarIntent.taskId}:null;
  const setCalendarSlot=(slot:{date:string;startTime:string;endTime:string;taskId?:string}|null)=>{if(slot)setCalendarIntent({open:true,...slot,taskId:slot.taskId??''});else discardCalendarIntent();};
  const [calendarSaving,setCalendarSaving] = useState(false); const calendarLock = useRef(false);
  const theme = useTheme();
  const categories = useCategories(growth.store,growth.journey?.id);
  const loading = growth.loading || plan.loading || monthly.loading;
  const error = growth.error ?? plan.error ?? monthly.error;
  const writesBlocked = calendarSaving || loading || !!error || !growth.currentPeriod || !plan.week;
  const availableTasks = plan.schedulableTasks ?? plan.week?.unscheduledTasks ?? [];
  const assertWritable = usePageWriteGuard(writesBlocked, growth.store,
    `${growth.currentPeriod?.id}:${plan.week?.startDate}:${plan.week?.endDate}`);
  const [selectedEvent, setSelectedEvent] = useState<ScheduleEvent | null>(null);
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  const [deletingEvent, setDeletingEvent] = useState<ScheduleEvent | null>(null);
  const [personalIntent, setPersonalIntent, discardPersonalIntent] = useCreationDraft('plan-personal-intent',
    growth.currentPeriod ? growth.currentPeriod.id : null,
    { open: false as boolean, date: '', startTime: '19:00', endTime: '20:00' });
  const personalDraft = personalIntent.open ? { date: personalIntent.date, startTime: personalIntent.startTime, endTime: personalIntent.endTime } : null;
  const setPersonalDraft = (slot: { date: string; startTime: string; endTime: string } | null) => {
    if (slot) setPersonalIntent({ open: true, ...slot }); else discardPersonalIntent();
  };
  const [showCourses, setShowCourses] = useState(false);
  const [courseRevision, setCourseRevision] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [slotDraft, setSlotDraft] = useState<{ date: string; startTime: string; endTime: string } | null>(null);
  const [taskDraft, setTaskDraft] = useState<typeof slotDraft>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [converting, setConverting] = useState<ScheduleEvent | null>(null);
  const busy = writesBlocked || editingEvent !== null || deletingEvent !== null || personalDraft !== null || taskDraft !== null || converting !== null;
  useEffect(() => {
    setSelectedEvent(null); setEditingEvent(null); setDeletingEvent(null);
    setFeedback(null);
    setSlotDraft(null); setTaskDraft(null); setConverting(null);
    setSelectedTask(null);
    setShowCourses(false);
  }, [growth.store, growth.currentPeriod?.id]);
  useEffect(() => { setSelectedEvent(null); setSlotDraft(null); }, [weekOffset]);
  const totalWeeks = growth.currentPeriod ? calculatePeriodWeek(
    growth.currentPeriod.startDate, growth.currentPeriod.endDate, growth.currentPeriod.endDate, growth.currentPeriod.weekStartsOn,
  ) : null;
  const month = navigation.selectedDate.slice(0, 7);
  const canPrev = navigation.viewMode === 'month' && growth.currentPeriod
    ? month > growth.currentPeriod.startDate.slice(0, 7) : plan.weekIndex !== null && plan.weekIndex > 1;
  const canNext = navigation.viewMode === 'month' && growth.currentPeriod
    ? month < growth.currentPeriod.endDate.slice(0, 7) : plan.weekIndex !== null && totalWeeks !== null && plan.weekIndex < totalWeeks;
  const personalDate = plan.week && todayIso() >= plan.week.startDate && todayIso() <= plan.week.endDate
    ? todayIso() : plan.week?.startDate ?? todayIso();
  useEffect(() => {
    const period = growth.currentPeriod;
    if (!route.taskId || !period || writesBlocked) return;
    const task = plan.semesterTasks.find(item => item.id === route.taskId && item.periodId === period.id);
    if ((route.periodId && route.periodId !== period.id) || !task || ['DONE', 'CANCELLED'].includes(task.status)) {
      setFeedback('该任务已变化、已完成或不属于当前阶段，请返回任务总览重新选择。');
    } else {
      setSelectedEvent(null); setEditingEvent(null); setDeletingEvent(null); setPersonalDraft(null); setConverting(null);
      setSelectedTask(task); setTaskDraft({ date: personalDate, startTime: '19:00', endTime: '20:00' }); setFeedback(null);
    }
    router.setParams({ taskId: undefined, periodId: undefined });
  }, [route.taskId, route.periodId, growth.currentPeriod, writesBlocked, plan.semesterTasks, personalDate]);
  useEffect(() => {
    const period = growth.currentPeriod;
    if (!route.eventId || !route.date || !period || growth.loading || growth.error) return;
    if ((route.periodId && route.periodId !== period.id) || !/^\d{4}-\d{2}-\d{2}$/.test(route.date) || route.date < period.startDate || route.date > period.endDate) {
      setFeedback('该日程不在当前阶段内。'); router.setParams({ eventId: undefined, date: undefined, periodId: undefined }); return;
    }
    const base = period.currentWeekOverride ?? calculatePeriodWeek(period.startDate, period.endDate, todayIso(), period.weekStartsOn);
    if (navigation.selectedDate !== route.date || navigation.viewMode !== 'week') {
      setNavigation(value => ({ ...value, selectedDate: route.date!, viewMode: 'week' }));
      return;
    }
    const offset = calculatePeriodWeek(period.startDate, period.endDate, route.date, period.weekStartsOn) - base;
    if (weekOffset !== offset) { setWeekOffset(offset); return; }
    if (plan.loading || plan.error || !plan.week) return;
    const event = plan.week.events.find(row => row.id === route.eventId && row.periodId === period.id);
    if (event) setSelectedEvent(event); else setFeedback('该日程已变化或删除，请重新选择。');
    router.setParams({ eventId: undefined, date: undefined, periodId: undefined });
  }, [route.eventId, route.date, route.periodId, navigation.selectedDate, navigation.viewMode, growth.currentPeriod, growth.loading, growth.error, weekOffset, plan.loading, plan.error, plan.week]);
  useEffect(() => {
    if (route.create !== 'temporary' || busy) return;
    setPersonalDraft({ date: personalDate, startTime: '19:00', endTime: '20:00' });
    router.setParams({ create: undefined });
  }, [route.create, busy, personalDate]);

  useEffect(() => {
    const p = growth.currentPeriod; if (!p) return;
    const date = navigation.selectedDate < p.startDate ? p.startDate : navigation.selectedDate > p.endDate ? p.endDate : navigation.selectedDate;
    if (date !== navigation.selectedDate) { setNavigation(value=>({...value,selectedDate:date})); return; }
    const base = p.currentWeekOverride ?? calculatePeriodWeek(p.startDate,p.endDate,todayIso(),p.weekStartsOn);
    setWeekOffset(calculatePeriodWeek(p.startDate,p.endDate,date,p.weekStartsOn)-base);
  },[growth.currentPeriod,navigation.selectedDate]);
  function navigateCalendar(direction: number) {
    const p=growth.currentPeriod;if(!p)return;
    const target=navigation.viewMode==='month'?todayIso(startOfMonth(addMonths(parseISO(navigation.selectedDate),direction))):todayIso(addDays(parseISO(navigation.selectedDate),direction*7));
    setNavigation(value=>({...value,selectedDate:target<p.startDate?p.startDate:target>p.endDate?p.endDate:target}));
  }
  async function changedEvent(before: ScheduleEvent, after: ScheduleEvent) {
    assertWritable(); if(calendarLock.current)throw new Error('正在保存，请稍候');
    const p=growth.currentPeriod;if(!p)throw new Error('阶段不可用');
    if(before.source!=='USER' || before.type==='COURSE')throw new Error('此时间块只读');
    if(after.date<p.startDate || after.date>p.endDate)throw new Error('日期超出当前阶段');
    calendarLock.current=true;setCalendarSaving(true);
    try {
      await plan.changeTimeBlock(before,after);
      setFeedback('时间块已保存；任务预计时长及执行记录保持。');await Promise.all([plan.reload(),monthly.reload()]);
    } finally { calendarLock.current=false;setCalendarSaving(false); }
  }
  function openPersonal(date = personalDate, startTime = '19:00', endTime = '20:00') {
    setPersonalDraft({ date, startTime, endTime });
    setFeedback(null);
  }

  return <Screen contentContainerStyle={styles.content}>
    <PageHeader eyebrow="计划" title={navigation.viewMode==='month'?navigation.selectedDate.slice(0,7):'这一周'}
      subtitle={growth.currentPeriod
        ? `${growth.currentPeriod.name}${plan.week ? ` · 第 ${plan.weekIndex} 周 · ${plan.week.startDate} — ${plan.week.endDate}` : ''}`
        : '把课程、任务和临时日程放在同一张时间表里。'} />

    {loading && !plan.week ? <ActivityIndicator color={theme.primary} accessibilityLabel="正在读取周安排" />
      : error && !plan.week ? <ScreenSection><Notice title="周安排读取失败">{error}</Notice>
        <Button label="重新读取周安排" onPress={() => { void growth.reload(); void plan.reload(); }} />
      </ScreenSection>
      : !growth.currentPeriod ? <ScreenSection>
        <AppText muted>请先选择当前阶段，再查看周安排。</AppText>
        <Button label="管理阶段" onPress={() => router.push('/period')} />
      </ScreenSection>
      : plan.week ? <>
        {loading ? <AppText muted>正在刷新，暂不可修改…</AppText> : null}
        {error ? <Notice title="当前数据尚未验证，仅可查看上次安排">{error}。刷新成功前不能写入。</Notice> : null}
        {error ? <Button label="重新读取周安排" onPress={() => { void growth.reload(); void plan.reload(); }} /> : null}
        <ScreenSection>
          <View style={styles.weekNav}>
            <ChoiceChip label="周视图" selected={navigation.viewMode==='week'} onPress={()=>setNavigation(value=>({...value,viewMode:'week'}))} />
            <ChoiceChip label="月视图" selected={navigation.viewMode==='month'} onPress={()=>setNavigation(value=>({...value,viewMode:'month'}))} />
          </View>
          <View style={styles.weekNav}>
            <Button label={navigation.viewMode==='month'?'上一月':'上一周'} variant="quiet" disabled={busy || !canPrev} onPress={() => navigateCalendar(-1)} />
            <Button label="本周" variant="secondary" disabled={busy || weekOffset === 0} onPress={() => setNavigation(value=>({...value,selectedDate:todayIso()}))} />
            <Button label={navigation.viewMode==='month'?'下一月':'下一周'} variant="quiet" disabled={busy || !canNext} onPress={() => navigateCalendar(1)} />
          </View>
          {navigation.viewMode==='month'?<MonthlyScheduleBoard selectedDate={navigation.selectedDate} events={monthly.events} goals={growth.goals}
            startDate={growth.currentPeriod.startDate} endDate={growth.currentPeriod.endDate} disabled={busy || !!calendarSlot}
            onDate={date=>{setNavigation(value=>({...value,selectedDate:date}));setCalendarSlot({date,startTime:'09:00',endTime:'10:00'});}}
            onEvent={setSelectedEvent} onChange={changedEvent} onError={setFeedback} />:<WeeklyScheduleBoard onChangeEvent={changedEvent} onInteractionError={setFeedback} weekStart={plan.week.startDate} weekEnd={plan.week.endDate} events={plan.week.events}
            weekStartsOn={growth.currentPeriod.weekStartsOn} conflicts={plan.week.conflicts} disabled={busy} categoryName={categories.name} selectedSlot={slotDraft} slotActionLabel="创建任务"
            onSelectEvent={(event) => { setSelectedEvent(event); setSlotDraft(null); setFeedback(null); }}
            onCreateSlot={(date, startTime, endTime) => { setSelectedEvent(null); setNavigation(value=>({...value,selectedDate:date}));setCalendarSlot({ date, startTime, endTime }); }} />}
          {navigation.viewMode === 'week' && !plan.week.events.length ? <AppText muted>本周暂无安排，可用下方按钮添加。</AppText> : null}
          <AppText variant="caption" muted>点击空白创建任务；拖动时间块移动，拖动底边调整本次时长。触摸设备长按后拖动。</AppText>
          {plan.week.conflicts.length ? <Notice title={`发现 ${plan.week.conflicts.length} 处时间重叠`}>
            冲突仅提示，不自动调整。
          </Notice> : null}
        </ScreenSection>

        {calendarSlot ? <CalendarTaskDialog key={JSON.stringify(calendarSlot)} slot={calendarSlot} initialTaskId={calendarSlot.taskId} initialMode={calendarSlot.taskId==='__choose__'?'existing':undefined} onCreateExisting={(input,request)=>{assertWritable();return plan.createEvent(input,request);}} store={growth.store} period={growth.currentPeriod} tasks={availableTasks}
          disabled={writesBlocked} assertWritable={assertWritable} onClose={()=>setCalendarSlot(null)} onSaved={async()=>{setCalendarSlot(null);setFeedback('已保存，日历和待办将读取同一记录。');await Promise.all([plan.reload(),monthly.reload()]);}} />:null}
        {slotDraft ? <ScreenSection>
          <AppText variant="label">所选时段 · {slotDraft.date} {slotDraft.startTime}–{slotDraft.endTime}</AppText>
          <Button label="取消选择时段" variant="quiet" onPress={() => setSlotDraft(null)} />
        </ScreenSection> : null}
        {taskDraft ? <ScreenSection>
          <AppText variant="heading">选择已有任务</AppText>
          <AppText muted>选择任务后填写日期和起止时间。已有安排会保留；删除任务请到今日页的长期任务总览。</AppText>
          <View style={styles.actions}>{availableTasks.map(task => <View key={task.id} style={styles.inlineButtons}>
            <ChoiceChip label={task.title} selected={selectedTask?.id === task.id} onPress={() => !writesBlocked && setSelectedTask(task)} />
          </View>)}</View>
          {!selectedTask && !availableTasks.length ? <AppText muted>暂无可安排任务，请先到今日页添加任务。</AppText> : null}
          {selectedTask ? <ScheduleEventForm key={selectedTask.id} task={selectedTask} period={growth.currentPeriod}
            defaultSlot={taskDraft} disabled={writesBlocked} onCancel={() => { setTaskDraft(null); setSelectedTask(null); }}
            onSubmit={async input => {
              assertWritable(); await plan.createEvent(input); setTaskDraft(null); setSelectedTask(null);
              setFeedback('任务时间已保存。'); await Promise.all([plan.reload(), monthly.reload()]);
            }} /> : <Button label="取消选择" variant="quiet" onPress={() => setTaskDraft(null)} />}
        </ScreenSection> : null}
        {converting ? <NewScheduledTaskForm key={converting.id}
          slot={converting} converting defaultTitle={converting.title}
          disabled={writesBlocked}
          goalContext={{ store: growth.store, period: growth.currentPeriod }}
          onCancel={() => { setTaskDraft(null); setConverting(null); void plan.reload(); }}
          onSubmit={async (input) => {
            assertWritable();
            const service = new CreateScheduledTaskService(growth.store);
            const result = { ...await service.convertPersonalEvent(converting, input), error: null };
            if (result.event) { setTaskDraft(null); setConverting(null); setFeedback('真实任务与时间块已保存。'); await Promise.all([plan.reload(), monthly.reload()]); }
            return result;
          }} /> : null}

        <Modal visible={!!selectedEvent || !!editingEvent || !!deletingEvent} transparent animationType="fade"
          onRequestClose={() => { setSelectedEvent(null); setEditingEvent(null); setDeletingEvent(null); }}>
        <View style={{ flex: 1, justifyContent: 'center', padding: 22, backgroundColor: 'rgba(0,0,0,0.25)' }}>
        <ScrollView style={{ flexGrow: 0, width: '100%', maxWidth: 716, alignSelf: 'center', maxHeight: '85%', backgroundColor: theme.background, borderRadius: 16 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
        {selectedEvent ? <View style={[styles.detail, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.detailHeader}>
            <View style={styles.detailText}>
              <AppText variant="heading">{selectedEvent.title}</AppText>
              <AppText variant="caption" muted>
                {categories.name(selectedEvent.categoryId ?? 'CUSTOM')} · {selectedEvent.date} {selectedEvent.startTime}–{selectedEvent.endTime} · {TYPE_LABELS[selectedEvent.type]} · {SOURCE_LABELS[selectedEvent.source]}
              </AppText>
            </View>
            <Button label="关闭" variant="quiet" onPress={() => setSelectedEvent(null)} />
          </View>
          {(selectedEvent.type === 'PERSONAL' || selectedEvent.type === 'TASK') && selectedEvent.source === 'USER' ? <View style={[styles.inlineButtons, { flexWrap: 'wrap' }]}>
            {selectedEvent.type === 'PERSONAL' ? <Button label="转为任务" variant="secondary" disabled={busy} onPress={() => { setConverting(selectedEvent); setSelectedEvent(null); }} /> : null}
            {isTimeBlockAdjustable(selectedEvent,availableTasks.find(t=>t.id===selectedEvent.taskId)) ? <Button label="让 AI 调整" variant="secondary" disabled={writesBlocked} onPress={()=>{router.push({pathname:'/coach',params:{eventId:selectedEvent.id,taskId:selectedEvent.taskId!,periodId:selectedEvent.periodId,date:selectedEvent.date}});setSelectedEvent(null);}} />:null}
            {selectedEvent.type === 'TASK' ? <Button label="再次安排时间" variant="secondary" disabled={busy} onPress={() => {
              if (writesBlocked) return;
              const task = availableTasks.find(item => item.id === selectedEvent.taskId);
              if (!task) { setFeedback('任务不存在或已完成，无法新增安排。'); return; }
              setSelectedTask(task); setTaskDraft({ date: personalDate, startTime: '18:00', endTime: '19:00' }); setSelectedEvent(null);
            }} /> : null}
            <Button label="修改时间" variant="secondary" disabled={busy} onPress={() => {
              setEditingEvent(selectedEvent); setSelectedEvent(null);
            }} />
            <Button label="删除" variant="quiet" disabled={busy} onPress={() => {
              setDeletingEvent(selectedEvent); setSelectedEvent(null);
            }} />
          </View> : <AppText variant="caption" muted>
            {selectedEvent.type === 'COURSE' ? '固定课程由“课程表”统一管理。' : '此记录仅供查看。'}
          </AppText>}
        </View> : null}
        {editingEvent && editingEvent.periodId === growth.currentPeriod.id ? <ScheduleEventForm
          store={growth.store} key={`edit:${editingEvent.id}`} mode="edit" event={editingEvent} period={growth.currentPeriod} disabled={writesBlocked}
          onCancel={() => setEditingEvent(null)} onSubmit={async (changes) => {
            assertWritable();
            const saved = await plan.updateEvent(editingEvent.periodId, editingEvent.id, changes);
            setEditingEvent(null);
            setFeedback(saved.date < plan.week!.startDate || saved.date > plan.week!.endDate
              ? `修改已保存至 ${saved.date}，不在本周显示。` : '修改已保存。');
            await Promise.all([plan.reload(), monthly.reload()]);
          }} /> : null}
        {deletingEvent && deletingEvent.periodId === growth.currentPeriod.id ? <ScheduleEventDeleteConfirmation
          key={`delete:${deletingEvent.id}`} event={deletingEvent} disabled={writesBlocked} onCancel={() => setDeletingEvent(null)}
          onConfirm={async () => {
            assertWritable();
            await plan.deleteEvent(deletingEvent.periodId, deletingEvent.id);
            setDeletingEvent(null); setFeedback('安排已删除，任务本身保持不变。');
            await Promise.all([plan.reload(), monthly.reload()]);
          }} /> : null}
        </ScrollView></View></Modal>

        <ScreenSection>
          <View style={styles.actions}>
            <Button label="给已有任务安排时间" variant="secondary" disabled={busy} onPress={() => {
              setCalendarSlot({...calendarSlot??slotDraft??{date:navigation.selectedDate,startTime:'19:00',endTime:'20:00'},taskId:'__choose__'});setSlotDraft(null);
            }} />
            <Button label="＋ 新建临时日程" variant="secondary" disabled={busy} onPress={() => {
              if (calendarSlot || slotDraft) { setPersonalDraft(calendarSlot ?? slotDraft!); setCalendarSlot(null); setSlotDraft(null); }
              else openPersonal();
            }} />
            <Button label={showCourses ? '收起课程表' : '课程表'} disabled={writesBlocked} variant="quiet" onPress={() => setShowCourses(value => !value)} />
          </View>
        </ScreenSection>

        {showCourses ? <ScreenSection>
          <CourseImportPanel period={growth.currentPeriod} store={growth.store} disabled={writesBlocked} assertWritable={assertWritable}
            onImported={() => { setCourseRevision(value => value + 1); void Promise.all([plan.reload(), monthly.reload()]); }} />
          <CourseManagerPanel revision={courseRevision} period={growth.currentPeriod} store={growth.store} disabled={writesBlocked} assertWritable={assertWritable}
            onChanged={() => { setFeedback('课程已更新。'); void Promise.all([plan.reload(), monthly.reload()]); }} />
        </ScreenSection> : null}

        {personalDraft ? <PersonalEventForm store={growth.store} disabled={writesBlocked} period={growth.currentPeriod} defaultDate={personalDraft.date}
          defaultStart={personalDraft.startTime} defaultEnd={personalDraft.endTime}
          onCancel={() => setPersonalDraft(null)} onSubmit={async (input) => {
            assertWritable();
            const saved = await plan.createEvent(input);
            setPersonalDraft(null);
            setFeedback(saved.date < plan.week!.startDate || saved.date > plan.week!.endDate
              ? `临时日程已保存至 ${saved.date}，不在本周显示。` : '临时日程已保存。');
            await Promise.all([plan.reload(), monthly.reload()]);
          }} /> : null}

        <AppText variant="caption" muted>
          任务是要完成的事；临时日程只占用日历时间。课程只读，重叠仅提示，删除时间块不会删除任务。
        </AppText>
      </> : null}

    {feedback ? <Notice title="操作结果">{feedback}</Notice> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  content: { gap: 20 },
  weekNav: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  detail: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  detailText: { flex: 1, gap: 3 },
  inlineButtons: { flexDirection: 'row', gap: 8 },
});
