import { isTimeBlockAdjustable } from '@/domain/replan/timeRuntime';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useGrowthData } from '@/application/hooks/useGrowthData';
import { useWeeklyPlan } from '@/application/hooks/useWeeklyPlan';
import { useConversationSession } from '@/application/hooks/useConversationSession';
import { createId, createReflectionRequestId } from '@/shared/id';
import { AgentContextService } from '@/application/agent/AgentContextService';
import { TimeReplanService } from '@/application/replan/TimeReplanService';
import { WeeklyReflectionService } from '@/application/reflection/WeeklyReflectionService';
import { backgroundReflection } from '@/application/reflection/backgroundReflection';
import { TimeReplanBackendClient } from '@/infrastructure/ai/TimeReplanBackendClient';
import { ReflectionBackendClient } from '@/infrastructure/ai/ReflectionBackendClient';
import type { Reflection } from '@/domain/reflection/types';
import { todayIso } from '@/shared/date';
import { format } from 'date-fns';
import { AppText } from '@/presentation/components/AppText';
import { Button } from '@/presentation/components/Button';
import { ChoiceChip } from '@/presentation/components/ChoiceChip';
import { Field } from '@/presentation/components/Field';
import { MemoryCandidateCard } from '@/presentation/components/ReflectionPanel';
import { GrowthReflectionCard } from '@/presentation/components/GrowthReflectionCard';
import { WeeklyAnalysisPanel } from '@/presentation/components/WeeklyAnalysisPanel';
import { useTheme } from '@/presentation/theme/tokens';
import { useTimeOperations } from '@/infrastructure/data/TimeOperationsContext';
import { TimeProposalCard } from '@/presentation/components/schedule/TimeProposalCard';
import { isSchedulingInput, schedulingTaskMatches, withDurationPreference } from '@/application/replan/coachSchedulingInput';
import { TaskApplicationService } from '@/application/tasks/TaskApplicationService';
import { usePageWriteGuard } from '@/application/hooks/usePageWriteGuard';
import type { Task } from '@/domain/tasks/types';
import { hasUnconfirmedRequests } from '@/application/agent/unconfirmedRequests';

type Action = 'schedule' | 'move' | 'reflection' | 'status';
const actions: { id: Action; label: string }[] = [
  { id: 'schedule', label: '安排任务' }, { id: 'move', label: '调整时间' },
  { id: 'reflection', label: '本周复盘' }, { id: 'status', label: '查看本周状态' },
];

export default function CoachScreen() {
  const growth = useGrowthData();
  // Journey/Period changes remount; focus cleanup also invalidates a replaced Store.
  return <Conversation key={growth.journey?.id + ':' + growth.currentPeriod?.id} growth={growth} />;
}

function Conversation({ growth }: { growth: ReturnType<typeof useGrowthData> }) {
  const { store, journey, currentPeriod } = growth;
  const route = useLocalSearchParams<{eventId?:string;taskId?:string;periodId?:string;date?:string}>();
  const theme = useTheme();
  const plan = useWeeklyPlan(store, currentPeriod);
  const operations = useTimeOperations();
  const service = useMemo(() => new TimeReplanService(store, new TimeReplanBackendClient(), () => new Date(), operations ?? undefined), [store, operations]);
  const reflectionService = useMemo(() => new WeeklyReflectionService(
    new AgentContextService(store), new ReflectionBackendClient(), store), [store]);
  const session = useConversationSession(store, journey?.id ?? null, currentPeriod?.id ?? null);
  const { messages, add } = session;
  const [manageHistory, setManageHistory] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [openMemoryMessage, setOpenMemoryMessage] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [fromCalendar,setFromCalendar] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [localBusy, setBusy] = useState(false);
  const reflectionRequests = useMemo(() => backgroundReflection(store, { journeyId: journey?.id ?? '', periodId: currentPeriod?.id ?? '' }), [store, journey?.id, currentPeriod?.id]);
  const reflectionRequest = useSyncExternalStore(reflectionRequests.subscribe, reflectionRequests.getSnapshot, reflectionRequests.getSnapshot);
  const reflectionPending = reflectionRequest?.status === 'pending';
  const busy = localBusy || reflectionPending;
  const [estimate, setEstimate] = useState('');
  const [requiredDuration, setRequiredDuration] = useState<Task | null>(null);
  const decisions = Object.fromEntries(messages.flatMap(message => message.decision
    ? [[message.decision.reflectionId + ':' + message.decision.index, message.decision.value]] : []));
  const generation = useRef(0);
  const requestId = useRef<string | null>(null);
  const locked = useRef(false);
  const pendingSchedule = useRef<{ text: string; taskId: string } | null>(null);
  const followMessages = useRef(true);
  const scroll = useRef<ScrollView>(null);
  const history = session.history.filter(item => item.messages.length > 0);
  const resumable = messages.findLast(message => message.reflectionInput && message.requestId
    && !messages.some(reply => reply.requestId === message.requestId && (reply.reflection || ['not_started', 'failed', 'unavailable'].includes(reply.reflectionRecovery ?? ''))));
  const focused = useRef(false);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => { focused.current = false; generation.current++; pendingSchedule.current = null; locked.current = false; setBusy(false); setRequiredDuration(null); };
  }, [store, journey?.id, currentPeriod?.id]));
  // Keep the draft on tab blur and discard it when its conversation changes.
  useEffect(() => {
    pendingSchedule.current = null;
    followMessages.current = true;
    setOpenMemoryMessage(null);
    setRequiredDuration(null); setInput(''); setEstimate(''); setAction(null);
    setSelected(null); setFromCalendar(false); setComposerExpanded(false);
  }, [store, journey?.id, currentPeriod?.id, session.id]);
  useEffect(() => {
    if (focused.current && reflectionRequest && reflectionRequest.status !== 'pending' && reflectionRequest.conversationId === session.id
      && !messages.some(message => message.id === reflectionRequest.messageId)) void session.reload();
  }, [reflectionRequest, session.id, session.reload]);
  const taskCandidates = (plan.semesterTasks ?? plan.week?.unscheduledTasks ?? []).filter(task => !['DONE', 'CANCELLED'].includes(task.status));
  const choices = !action || action === 'schedule'
    ? taskCandidates.map((task) => ({ id: task.id, label: task.title + (taskCandidates.filter(other => other.title.trim() === task.title.trim()).length > 1 ? ` · ${task.estimatedMinutes ? task.estimatedMinutes+'分钟' : '时长待补'} · ${task.plannedDate ?? '未排日期'} · ${task.id.slice(-8)}` : '') }))
    : action === 'move'
      ? (plan.week?.events ?? []).filter(event => isTimeBlockAdjustable(event, taskCandidates.find(t=>t.id===event.taskId))).map(event => ({ id: event.id, label: event.title + ' · ' + event.date + ' ' + event.startTime }))
      : [];
  const named = schedulingTaskMatches(input, taskCandidates);
  const hasScheduleRequest = isSchedulingInput(input) || named.length > 0 || /\d+\s*分钟/.test(input);
  const isNewSchedule = !plan.loading && !plan.error && !selected && !named.length
    && (action === 'schedule' || (!action && hasScheduleRequest));
  const scheduling = !action || action === 'schedule';
  const durationPattern = /(\d+(?:\.\d+)?)\s*分钟/;
  const inlineDuration = scheduling ? input.match(durationPattern) : null;
  const enteredDuration = inlineDuration?.[1] || estimate.trim();
  function changeDuration(value: string) {
    if (inlineDuration) {
      setInput(input.replace(durationPattern, value ? value + '分钟' : ''));
      setEstimate('');
    } else setEstimate(value);
  }
  const minutes = Number(enteredDuration);
  const invalidNewDuration = isNewSchedule && !!enteredDuration && (minutes < 30 || minutes > 240 || minutes % 30 !== 0);
  const sendDisabled = busy || session.loading || !!session.error || growth.loading || !!growth.error
    || !journey || !currentPeriod || !input.trim() || invalidNewDuration;
  const durationTask = action !== 'schedule' ? undefined : selected
    ? (requiredDuration?.id === selected ? requiredDuration : taskCandidates.find(task => task.id === selected))
    : named.length === 1 ? named[0] : undefined;
  const durationGeneration = generation.current;
  const assertWritable = usePageWriteGuard(busy || growth.loading || !!growth.error || plan.loading || !!plan.error || session.loading || !!session.error,
    store, JSON.stringify([journey?.id, currentPeriod?.id, session.id, action, durationTask?.id]));

  function clearDurationRequest() {
    pendingSchedule.current = null;
    setRequiredDuration(null);
  }

  useEffect(()=>{
    if(!route.eventId || !currentPeriod || plan.loading || growth.loading || session.loading)return;
    let active=true;
    void (async()=>{
      if(route.periodId!==currentPeriod.id || !route.taskId || !route.date || !store.scheduleEvents)throw new Error('所选时间块上下文无效');
      const rows=await store.scheduleEvents.queryByDateRange({periodId:currentPeriod.id,startDate:route.date,endDate:route.date});
      const event=rows.find(row=>row.id===route.eventId && row.taskId===route.taskId && row.type==='TASK' && row.source==='USER');
      if(!event)throw new Error('所选时间块已变化或删除，请返回日历重新选择');
      if(!isTimeBlockAdjustable(event,await store.getTask(route.taskId)))throw new Error('原时间块已经开始或任务不可调整，请返回日历');
      if(active){setFromCalendar(true);setAction('move');setSelected(event.id);setInput('');setComposerExpanded(true);add({role:'agent',text:`正在调整：${event.title} · ${event.date} ${event.startTime}–${event.endTime}。请说明新的时间，生成后仍需确认。`});}
    })().catch(e=>{if(active)add({role:'agent',text:e instanceof Error?e.message:'无法读取所选时间块',status:'failed'});}).finally(()=>{if(active)router.setParams({eventId:undefined,taskId:undefined,periodId:undefined,date:undefined});});
    return()=>{active=false;};
  },[route.eventId,route.taskId,route.periodId,route.date,store,currentPeriod,plan.loading,growth.loading,session.loading]);
  function choose(next: Action) {
    if (locked.current || reflectionRequests.getSnapshot()?.status === 'pending' || session.loading || session.error) return;
    if (next === 'status') {
      setComposerExpanded(false);
      void send(false, undefined, true);
      return;
    }
    setFromCalendar(false);setAction(next); setSelected(null);
    setComposerExpanded(next === 'move');
    generation.current++;
    clearDurationRequest();
    if (next === 'reflection') setInput(actions.find(item => item.id === next)!.label);
    else if (actions.some(item => (item.id === 'reflection' || item.id === 'status') && item.label === input)) setInput('');

    add({ role: 'agent', text: next === 'schedule' || next === 'move'
      ? next === 'schedule' ? '写下任务和方便的时间。' : '想调整哪一项？选好后，告诉我你方便的时间。建议不会自动执行。'
      : '发送可查看本周复盘；需要更新时，点击“重新生成本周复盘”。' });
  }

  async function send(regenerate = false, resume?: { text: string; taskId: string }, readStatus = false) {
    if (locked.current || reflectionRequests.getSnapshot()?.status === 'pending' || session.loading || session.error || growth.loading || growth.error || !journey || !currentPeriod) return;
    const message = readStatus ? '查看本周状态' : resume?.text ?? input;
    if (!message.trim() && !regenerate) return;
    const mode = readStatus ? 'status' : resume ? 'schedule' : action ?? (hasScheduleRequest ? 'schedule' : null);
    if (mode === 'reflection' && resumable && resumable.reflectionInput?.epoch === session.epoch) {
      add({ role: 'agent', text: '请先点击“读取未完成复盘”核对上一次结果，再开始新的复盘。' });
      return;
    }
    if (!mode) {
      if (!input.trim()) return;
      add({ role: 'user', text: input.trim() });
      add({ role: 'agent', text: '请补充方便的时间，例如“明天下午练听力”。也可以打开“更多选项”查看本周记录。' });
      return;
    }
    if (!plan.week || plan.loading || plan.error) {
      add({ role: 'agent', text: '正在核对当前阶段的日历，请刷新成功后再发送。未调用模型或执行排程。' }); return;
    }
    let text = message.trim();
    if (!resume && (mode === 'schedule' || mode === 'move')) {
      try { text = withDurationPreference(text, inlineDuration ? '' : estimate); }
      catch (error) { add({ role: 'agent', text: error instanceof Error ? error.message : '预计时长无效' }); return; }
    }
    if (mode === 'move' && !selected) {
      add({ role: 'agent', text: '请选择要调整的时间块，再描述方便的时间；不会替你猜测修改对象。' }); return;
    }
    if (!readStatus && !resume && invalidNewDuration) return;
    let request: string;
    try { request = mode === 'reflection' ? createReflectionRequestId() : createId('request'); }
    catch {
      add({ role: 'agent', text: '当前环境无法安全创建复盘请求，请使用 HTTPS、本机 localhost 或更新后的应用。此次未发送。' });
      return;
    }
    if (!readStatus) setAction(mode);
    locked.current = true; setBusy(true);
    const token = ++generation.current;
    requestId.current = request;
    const selectedTaskId = resume?.taskId ?? selected;
    add({ role: 'user', text: (selected && !readStatus ? '选择：' + (selected === '__new_task__' ? '新建任务并安排' : choices.find(item => item.id === selected)?.label) + '\n' : '') + (text || actions.find(item => item.id === mode)!.label), status: 'pending', requestId: request,
      ...(mode === 'reflection' ? { reflectionInput: { date: todayIso(), epoch: session.epoch ?? 'unknown' } } : {}) });
    if (!readStatus) setInput('');
    if (mode === 'reflection') {
      if (!session.id) { locked.current = false; setBusy(false); return; }
      const reflectionInput = { journeyId: journey.id, periodId: currentPeriod.id, date: todayIso() };
      reflectionRequests.start(session.id, request, async () => {
        await session.flush();
        const history = regenerate ? null : await reflectionService.latest(reflectionInput);
        return { reflection: history ?? await reflectionService.generate(reflectionInput, request, false, true), history: history !== null };
      });
      locked.current = false; setBusy(false);
      return;
    }
    try {
      await session.flush();
      if (token !== generation.current) return;
      if (mode === 'schedule' || mode === 'move') {
        const window = { startDate: plan.week.startDate, endDate: plan.week.endDate };
        let target: Task | null = null;
        if (mode === 'schedule') {
          const tasks = (await store.listTasks({ periodId: currentPeriod.id }))
            .filter(task => task.periodId === currentPeriod.id && !['DONE', 'CANCELLED'].includes(task.status));
          if (token !== generation.current) return;
          const matches = schedulingTaskMatches(message.trim(), tasks);
          if (matches.length > 1 && !matches.some(task => task.id === selectedTaskId)) throw new Error('找到多个同名或相关任务，请选择具体任务后再发送');
          const explicitlySelected = tasks.find(task => task.id === selectedTaskId);
          if (selectedTaskId && selectedTaskId !== '__new_task__' && !explicitlySelected) throw new Error('所选任务已不可用，请重新选择');
          if (explicitlySelected && matches.length && !matches.some(task => task.id === explicitlySelected.id)) throw new Error('输入内容与所选任务不一致，请修改描述或重新选择任务');
          target = explicitlySelected ?? matches[0] ?? null;
        }
        if (token !== generation.current) return;
        const explicitMove = mode === 'schedule' && target && /改到|移到|挪到|调整/.test(message);
        const assigned = explicitMove ? (await store.scheduleEvents!.queryByDateRange({ periodId: currentPeriod.id,
          startDate: currentPeriod.startDate, endDate: currentPeriod.endDate }))
          .filter(event => event.taskId === target?.id && isTimeBlockAdjustable(event,target)) : [];
        if (token !== generation.current) return;
        if (explicitMove && assigned.length !== 1) throw new Error('请选择“调整时间”中的具体时间块；新增安排请使用“安排任务”');
        if (target && !target.estimatedMinutes && !enteredDuration) {
          pendingSchedule.current = { text, taskId: target.id }; setSelected(target.id); setRequiredDuration(target);
          setComposerExpanded(true);
          throw new Error(`已读取任务“${target.title}”，请填写并保存预计分钟，将继续生成建议；不会重复新建任务`);
        }
        const proposeMove = (eventId: string) => enteredDuration ? service.propose(eventId, text, fromCalendar?undefined:window, Number(enteredDuration)) : service.propose(eventId, text, fromCalendar?undefined:window);
        const result = explicitMove ? await proposeMove(assigned[0].id)
          : mode === 'schedule' ? target ? await (enteredDuration?service.proposeSchedule(target.id, text, window, undefined, Number(enteredDuration)):service.proposeSchedule(target.id, text, window)) : await service.proposeNewTask(text, window)
          : await proposeMove(selected!);
        if (token !== generation.current) {
          if (result.operation && service.canCancel) await service.cancel(result.operation);
          return;
        }
        add({ role: 'agent', text: 'AI 建议 · 尚未执行', proposal: result.proposal,
          timeOperation: result.operation ?? undefined, status: 'complete', requestId: request });
        pendingSchedule.current = null; setSelected(null); setRequiredDuration(null);
      } else {
        const context = await new AgentContextService(store).build({ journeyId: journey.id, periodId: currentPeriod.id, date: todayIso() });
        if (token !== generation.current) return;
        const facts = context.planVsReality;
        add({ role: 'agent', text: '系统事实 · ' + context.currentWeek.windowStart + ' — ' + context.currentWeek.windowEnd
          + '\n已完成 ' + facts.completedTaskCount + ' / ' + facts.plannedTaskCount
          + ' · 计划 ' + facts.plannedMinutes + ' 分钟 · 实际 ' + (facts.actualMinutes ?? '未知') + ' 分钟', analysis: true, status: 'complete', requestId: request });
      }
    } catch (error) {
      if (token === generation.current) { add({ role: 'agent', status: 'failed', requestId: request,
        ...(mode === 'move' || mode === 'schedule' ? { schedulingDraft: { action: mode, input: message.slice(0, 2000), estimate, selected: selectedTaskId, fromCalendar } } : {}),
        text: '未完成：' + (error instanceof Error ? error.message : '请求失败') + '。未自动重试，未执行排程。' }); }
    } finally {
      if (token === generation.current) { locked.current = false; setBusy(false); }
    }
  }

  async function saveCandidate(reflection: Reflection, index: number) {
    if (locked.current || !journey || session.loading || session.error) return;
    locked.current = true; setBusy(true);
    const token = ++generation.current;
    try {
      const memory = await reflectionService.confirmCandidate(journey.id, reflection.id, index);
      if (token === generation.current) add({ role: 'agent', text: '记忆候选确认结果',
        decision: { reflectionId: reflection.id, index, value: memory.status === 'ACTIVE' ? '已确认保存' : '已有归档记忆，未重新激活' } });
    } catch (error) {
      if (token === generation.current) add({ role: 'agent', text: '记忆保存未确认：' + (error instanceof Error ? error.message : '保存失败') });
    } finally { if (token === generation.current) { locked.current = false; setBusy(false); } }
  }

  const shortcuts = actions.map(item => <ChoiceChip key={item.id} label={item.label} selected={(action ?? 'schedule') === item.id}
    onPress={() => {
      if (!currentPeriod && !growth.loading) { router.push('/period'); return; }
      if (!busy && !session.loading && !session.error && !growth.loading && !growth.error) choose(item.id);
    }} />);
  return <SafeAreaView style={[styles.fill, { backgroundColor: theme.background }]} edges={['top']}>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <View style={[styles.headerRow,{borderBottomColor:theme.border}]}><View style={styles.brand}><AppText style={{color:theme.primary,fontSize:26,lineHeight:32}}>✤</AppText><AppText style={{fontSize:23,lineHeight:30,fontWeight:'800',color:theme.primary}}>GrowAI智能体</AppText></View>
          {currentPeriod ? <Button label={showHistory ? '收起历史' : '历史记录'} variant="quiet" onPress={() => { setShowHistory(value => !value); setManageHistory(false); setConfirmClear(false); }} /> : null}
        </View>
        {showHistory ? <View style={styles.history}>
          <AppText variant="caption" muted>仅显示当前阶段的本地记录，历史不会自动发送给模型。</AppText>
          {!session.loading && !session.error && !history.length ? <AppText muted>暂无历史</AppText> : null}
          {session.loading ? <AppText muted>正在读取历史…</AppText> : null}
          <ScrollView style={styles.historyList}>
            {history.map(item => {
              const requests = item.messages.filter(message => message.role === 'user');
              const title = requests.find(message => !actions.some(action => action.label === message.text))?.text
                ?? requests[0]?.text ?? '未发送消息的对话';
              const preview = title.replace(/\s+/g, ' ').slice(0, 42);
              const time = formatHistoryTime(item.createdAt);
              return item.id === session.id
                ? <View key={item.id}><AppText variant="label">{preview}</AppText><AppText muted variant="caption">{time} · 当前对话</AppText></View>
                : <Button key={item.id} label={preview + '\n' + time} variant="quiet" disabled={busy || session.loading}
                    onPress={() => { setAction(null); setShowHistory(false); void session.select(item.id); }} />;
            })}
          </ScrollView>
          <View style={styles.controls}>
          <Button label="新建对话" variant="quiet" disabled={busy || session.loading || !!session.error} onPress={() => { setAction(null); setShowHistory(false); void session.newConversation(); }} />
          {history.length ? <Button label={manageHistory ? '收起管理' : '管理历史'} variant="quiet" onPress={() => { setManageHistory(!manageHistory); setConfirmClear(false); }} /> : null}
          {manageHistory && history.length ? <Button label="清空本阶段历史" variant="quiet" disabled={busy || session.loading} onPress={() => setConfirmClear(true)} /> : null}
          </View>
        {confirmClear ? <View><AppText>确认清空当前数据空间、本旅程、本阶段的全部会话？任务和记忆不会删除。</AppText>
          <Button label="确认清空历史" disabled={busy || session.loading} onPress={() => { setConfirmClear(false); setAction(null); void session.clear(); }} />
          <Button label="保留历史" variant="quiet" onPress={() => setConfirmClear(false)} /></View> : null}
        </View> : null}
      </View>
      <ScrollView ref={scroll} style={styles.fill} contentContainerStyle={[styles.messages, !messages.length && styles.emptyMessages]} keyboardShouldPersistTaps="handled"
        scrollEventThrottle={32}
        onScroll={({ nativeEvent: { contentOffset, layoutMeasurement, contentSize } }) => {
          followMessages.current = contentSize.height - layoutMeasurement.height - contentOffset.y < 72;
        }}
        onContentSizeChange={() => { if (followMessages.current) scroll.current?.scrollToEnd({ animated: true }); }}>
        {!messages.length ? <View style={styles.welcome}>
          {currentPeriod ? <AppText variant="caption" muted>当前阶段 · {currentPeriod.name}</AppText> : null}
          <AppText variant="title">{currentPeriod ? '想安排什么任务？' : growth.loading ? '正在读取阶段…' : '先选择一个阶段'}</AppText>
          {currentPeriod ? <AppText muted>写下任务和时间，确认建议后加入日历。</AppText> : null}
        </View> : null}
        {!currentPeriod && !growth.loading ? <Button label="创建或选择阶段" onPress={() => router.push('/period')} /> : null}
        {messages.map(message => <View key={message.id} style={[styles.bubble, {
          alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
          backgroundColor: message.role === 'user' ? theme.primarySoft : theme.surface,
          borderColor: theme.border,
        }]}>
          <AppText variant="caption" muted>{message.role === 'user' ? '你 · 用户输入' : 'GrowAI'}</AppText>
          <AppText>{message.text}</AppText>
          {message.schedulingDraft ? <Button label="带回输入框" variant="quiet" disabled={busy || session.loading}
            onPress={() => {
              const draft = message.schedulingDraft!;
              clearDurationRequest(); setAction(draft.action); setSelected(draft.selected); setFromCalendar(draft.fromCalendar);
              setEstimate(draft.estimate); setInput(draft.input); setComposerExpanded(true);
            }} /> : null}
          {message.status === 'pending' && !messages.some(item => item.requestId === message.requestId && ['complete', 'failed', 'cancelled'].includes(item.status))
            ? <AppText muted>{busy ? '等待本次响应…' : '该请求已中断或结果未确认，未自动重发；请核对真实数据。'}</AppText> : null}
          {message.proposal && message.timeOperation && service.canConfirm ? <TimeProposalCard
            reference={message.timeOperation} service={service} reason={message.proposal.reason}
            store={store} scope={`${journey?.id}:${currentPeriod?.id}:${session.id}`}
            blocked={busy || growth.loading || !!growth.error || plan.loading || !!plan.error || session.loading || !!session.error}
            onSaved={async () => { await plan.reload(); }} /> : message.proposal ? <>
            {'before' in message.proposal ? <AppText>原安排：{message.proposal.before.date} {message.proposal.before.startTime}–{message.proposal.before.endTime}</AppText> : null}
            {'action' in message.proposal ? <AppText>建议新建任务：{message.proposal.taskTitle} · {message.proposal.date} {message.proposal.startTime}–{message.proposal.endTime}</AppText>
              : <AppText>建议：{message.proposal.after.date} {message.proposal.after.startTime}–{message.proposal.after.endTime}</AppText>}
            {'before' in message.proposal ? <AppText variant="caption">时长：{(Number(message.proposal.after.endTime.slice(0, 2)) - Number(message.proposal.after.startTime.slice(0, 2))) * 60
              + Number(message.proposal.after.endTime.slice(3)) - Number(message.proposal.after.startTime.slice(3))} 分钟</AppText> : null}
            <AppText muted>AI 理由：{message.proposal.reason}</AppText>
            <AppText variant="caption">建议不代表已经执行。此记录没有当前数据空间的执行授权，你可以在计划页手动安排。</AppText>
          </> : null}
          {message.analysis ? <><AppText variant="caption" muted>以下为可选只读 AI 分析，不是执行事实。</AppText>
            <WeeklyAnalysisPanel journeyId={journey?.id ?? null} onResult={result => add({ role: 'agent', text: '只读 AI 分析（不是已验证事实）\n' + result.summary
              + '\n观察：' + result.observations.map(item => item.title + '；证据：' + item.evidence).join('\n')
              + '\n风险：' + result.risks.map(item => item.title + '；' + item.reason).join('\n')
              + '\n建议：' + result.suggestions.map(item => item.title + '；' + item.reason).join('\n')
              + '\n数据缺口：' + result.data_gaps.join('；') })} />
          </> : null}
          {message.reflection ? <>
            <GrowthReflectionCard reflection={message.reflection} />
            {message.reflection.memoryCandidates.length > 0 ? <Button variant="quiet"
              label={openMemoryMessage === message.id ? '收起记忆候选' : '查看记忆候选'}
              onPress={() => setOpenMemoryMessage(current => current === message.id ? null : message.id)} /> : null}
            {openMemoryMessage === message.id && message.reflection.memoryCandidates.map((candidate, index) => <MemoryCandidateCard key={index} candidate={candidate}
              disabled={busy || session.loading || !!session.error} decision={decisions[message.reflection!.id + ':' + index]}
              onSave={() => void saveCandidate(message.reflection!, index)}
              onIgnore={() => add({ role: 'agent', text: '已忽略记忆候选', decision: { reflectionId: message.reflection!.id, index, value: '已忽略，未写入长期记忆' } })} />)}
          </> : null}
        </View>)}
        {busy ? <View style={[styles.bubble, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <AppText accessibilityLiveRegion="polite">{reflectionPending ? '正在思考中…可以切换页面，复盘会继续生成并保存。' : '正在处理，请稍候…'}</AppText>
        </View> : null}
        {reflectionRequest?.error ? <AppText accessibilityLiveRegion="polite">{reflectionRequest.error}</AppText> : null}
        {resumable && !busy ? <Button label="读取未完成复盘（不重新生成）" variant="quiet" disabled={session.loading || !!session.error || !!growth.error} onPress={() => {
          if (!journey || !currentPeriod || !session.id || !resumable.requestId || !resumable.reflectionInput) return;
          if (resumable.reflectionInput.epoch !== session.epoch) {
            add({ role: 'agent', text: '数据空间已恢复或重置，旧请求不能恢复写入；未重新生成。' }); return;
          }
          reflectionRequests.start(session.id, resumable.requestId, async () => ({
            reflection: await reflectionService.generate({ journeyId: journey.id, periodId: currentPeriod.id, date: resumable.reflectionInput!.date }, resumable.requestId, true, true), history: false, recovered: true,
          }));
        }} /> : null}
        {!busy && !session.loading && hasUnconfirmedRequests(messages) ? <AppText accessibilityLiveRegion="polite" muted>当前页面无法确认此前请求是否完成。请先查看已保存的复盘和会话记录，避免重复生成；没有自动重新发送。</AppText> : null}
        {growth.error || plan.error ? <AppText>{growth.error ?? plan.error}</AppText> : null}
        {session.error ? <View><AppText>{session.error}</AppText><Button label="重新读取本地会话" onPress={() => void session.reload()} /></View> : null}
      </ScrollView>
      {currentPeriod ? <View style={[styles.composer, { borderColor: theme.border, backgroundColor: theme.surface }]}>

        <View style={styles.controls}>
          <Button label={composerExpanded ? '收起选项' : '更多选项'} variant="quiet" onPress={() => setComposerExpanded(value => !value)} />
          {!composerExpanded && enteredDuration && scheduling && !invalidNewDuration ? <Button label={enteredDuration + ' 分钟 · 修改'} variant="quiet" onPress={() => setComposerExpanded(true)} /> : null}
          {invalidNewDuration ? <Button label="改为30分钟" variant="secondary" onPress={() => changeDuration('30')} /> : null}
        </View>
        {invalidNewDuration ? <AppText accessibilityLiveRegion="polite">新建任务支持 30–240 分钟，按 30 分钟递增。</AppText> : null}
        {composerExpanded ? <ScrollView style={{maxHeight:180,flexGrow:0}} contentContainerStyle={{gap:6}} keyboardShouldPersistTaps="handled">
          <View style={styles.controls}>{shortcuts}</View>
          {scheduling || action === 'move' ? <Field label="预计时长（分钟，可选）" value={enteredDuration ?? ''} onChangeText={changeDuration} keyboardType="number-pad"
            placeholder="例如 30，留空则不指定" editable={!busy && !session.loading && !session.error} maxLength={3} /> : null}
        {composerExpanded && durationTask && !durationTask.estimatedMinutes ? <View>
          <AppText variant="caption">已找到“{durationTask.title}”，缺少预计时长；保存后继续生成建议，不会自动执行。</AppText>
          <Button label="保存预计时长" disabled={busy || growth.loading || !!growth.error || plan.loading || !!plan.error} variant="quiet" onPress={() => {
            const save = async () => {
              const token = durationGeneration;
              if (locked.current || token !== generation.current) return;
              const pending = pendingSchedule.current;
              let ownsLock = false;
              try {
                assertWritable();
                const minutes = Number(enteredDuration);
                if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 240) throw new Error('请填写 1–240 的整数分钟');
                const task = await store.getTask(durationTask.id); assertWritable();
                if (!task || task.id !== durationTask.id || task.periodId !== currentPeriod?.id) throw new Error('任务作用域已变化，请重新读取');
                if (locked.current || token !== generation.current) return;
                locked.current = true; ownsLock = true; setBusy(true);
                await new TaskApplicationService(store).updateTask({ taskId: task.id, changes: { estimatedMinutes: minutes } });
                if (token !== generation.current) return;
                setRequiredDuration(null); locked.current = false; setBusy(false);
                if (pending && pending === pendingSchedule.current && pending.taskId === task.id) { pendingSchedule.current = null; await send(false, pending); }
                else add({ role: 'agent', text: '预计时长已保存，可以发送时间偏好生成建议。未执行排程。' });
                if (generation.current === token || generation.current === token + 1) await plan.reload();
              } catch (error) { if (token === generation.current) add({ role: 'agent', text: error instanceof Error ? error.message : '预计时长保存失败' }); }
              finally { if (ownsLock && token === generation.current) { locked.current = false; setBusy(false); } }
            }; void save();
          }} />
        </View> : null}
        {scheduling || action === 'move' ? <ScrollView horizontal contentContainerStyle={styles.shortcuts}>
          {choices.length ? choices.map(item => <ChoiceChip compact key={item.id} label={item.label} selected={selected === item.id} onPress={() => {
            if (busy || locked.current || item.id === selected) return;
            generation.current++;
            clearDurationRequest();
            if (durationTask && durationTask.id !== item.id) setEstimate('');
            if (!action) setAction('schedule');
            setSelected(item.id);
          }} />)
            : <AppText muted>{plan.loading ? '读取候选中…' : scheduling ? '当前阶段暂无已有任务，直接输入可建议新建。' : '本周暂无可调整的任务时间块。'}</AppText>}
        </ScrollView> : null}
        </ScrollView> : null}
        {action === 'reflection' ? <Button label="重新生成本周复盘" variant="quiet" disabled={busy || session.loading || !!session.error || plan.loading || !!plan.error || !!growth.error} onPress={() => void send(true)} /> : null}
          {(action && (composerExpanded || localBusy)) && !reflectionPending ? <Button label="取消当前操作" variant="quiet" onPress={() => {
            generation.current++; pendingSchedule.current = null; locked.current = false; setBusy(false); setAction(null); setSelected(null); setInput('');
            add({ role: 'agent', status: 'cancelled', requestId: requestId.current ?? undefined, text: '已取消当前操作，不再展示迟到结果。已发出的请求可能仍在处理，复盘或已确认的记忆保存不会被撤销；如有疑问请只读核验记录。未执行排程。' });
          }} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ flex: 1 }}>
        <Field label="消息" value={input} onChangeText={value => { setInput(value); clearDurationRequest(); if (action !== 'move' && durationPattern.test(value)) setEstimate(''); }} multiline={false}
          editable={!session.loading && !session.error}
          style={{ borderWidth: 0, backgroundColor: theme.background, minHeight: 46, borderRadius:10, paddingHorizontal: 12, paddingVertical: 6 }}
          maxLength={2000} placeholder={action === 'reflection' || action === 'status' ? '发送查看本周记录' : '例如：明天下午安排听力，30分钟'} />
        </View><Button label="发送" loading={busy} disabled={sendDisabled} onPress={() => void send()} /></View>
      </View> : null}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
function formatHistoryTime(value: string) {
  return format(new Date(value), 'yyyy-MM-dd HH:mm');
}
const styles = StyleSheet.create({
  fill: { flex: 1 }, header: { width:'100%',maxWidth:760,alignSelf:'center',paddingHorizontal:16,paddingTop:8,gap:8 },
  brand:{flexDirection:'row',gap:8,alignItems:'center'}, headerRow: { minHeight:52,borderBottomWidth:1,flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  history: { gap: 8, paddingBottom: 8 }, historyList: { maxHeight: 150 },
  welcome: { gap: 8, paddingVertical: 12 },
  messages: { padding: 16, gap: 14, width: '100%', maxWidth: 760, alignSelf: 'center' },
  emptyMessages: { flexGrow: 1, justifyContent: 'flex-end' },
  bubble: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10, maxWidth: '95%' },
  composer: { borderWidth: 1,borderRadius:16, padding: 12, gap: 6, width: '100%', maxWidth: 760, alignSelf: 'center' },
  shortcuts: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
});
