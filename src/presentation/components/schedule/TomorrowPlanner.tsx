import { TaskApplicationService } from '@/application/tasks/TaskApplicationService';
import { useTheme } from '../../theme/tokens';
import { useFocusEffect } from 'expo-router';
import type { TimeOperationReference } from '@/application/replan/TimeOperationAdapter';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { GrowthStore } from '@/application/data/GrowthStore';
import type { TimeReplanService } from '@/application/replan/TimeReplanService';
import { TomorrowPlanningService } from '@/application/replan/TomorrowPlanningService';
import { WeeklyScheduleBoard } from './WeeklyScheduleBoard';
import { TimeProposalCard } from './TimeProposalCard';
import { AppText } from '../AppText';
import { Button } from '../Button';
import { Field } from '../Field';
import { usePageWriteGuard } from '@/application/hooks/usePageWriteGuard';
import { startOfWeek, parseISO } from 'date-fns';
import { todayIso } from '@/shared/date';

export function TomorrowPlanner({ store, service, blocked, onOpenChange }: { store: GrowthStore; service: TimeReplanService; blocked: boolean; onOpenChange?: (open: boolean) => void }) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [duration, setDuration] = useState<{ id: string; value: string } | null>(null);
  const [open,setOpen] = useState(false); const [facts,setFacts] = useState<Awaited<ReturnType<TomorrowPlanningService['read']>>|null>(null);
  const [start,setStart] = useState(''); const [end,setEnd] = useState(''); const [preference,setPreference] = useState('');
  const [candidate,setCandidate] = useState<Awaited<ReturnType<TomorrowPlanningService['propose']>>|null>(null);
  const [recovery,setRecovery]=useState<{reference:TimeOperationReference;previous:Awaited<ReturnType<TomorrowPlanningService['propose']>>}|null>(null);
  const [edit,setEdit] = useState<{date:string;startTime:string;endTime:string}|null>(null);
  const [busy,setBusy] = useState(false); const [error,setError] = useState(''); const generation = useRef(0);
  const locks=useRef({store,service,value:{current:false}});
  if(locks.current.store!==store || locks.current.service!==service)locks.current={store,service,value:{current:false}};
  const actionLock=locks.current.value;
  const planner = new TomorrowPlanningService(store,service);
  const guard = usePageWriteGuard(blocked||busy,store,'tomorrow-planning');
  useEffect(()=>{generation.current++;actionLock.current=false;setBusy(false);setFacts(null);setCandidate(null);setEdit(null);setRecovery(null);return()=>{generation.current++;};},[store,service]);
  useFocusEffect(useCallback(()=>()=>{generation.current++;locks.current.value={current:false};setBusy(false);setCandidate(null);setEdit(null);setRecovery(null);},[store,service]));
  async function load() {
    if(actionLock.current)return;actionLock.current=true;
    const token=++generation.current;setBusy(true);setError('');setOpen(true);onOpenChange?.(true);
    try{const next=await planner.read();if(token===generation.current)setFacts(next);}catch(e){if(token===generation.current)setError(e instanceof Error?e.message:'读取失败');}finally{if(token===generation.current){actionLock.current=false;setBusy(false);}}
  }
  async function propose(id:string) {
    if(actionLock.current)return;
    try{guard();}catch(e){setError((e as Error).message);return;}
    actionLock.current=true;const token=++generation.current;setBusy(true);setError('');
    try{
      const result=await planner.propose(id,start,end,preference);
      if(token!==generation.current){if(result.operation&&service.canCancel)await service.cancel(result.operation);return;}
      setCandidate(result);
    }catch(e){if(token===generation.current)setError(e instanceof Error?e.message:'建议失败');}finally{if(token===generation.current){actionLock.current=false;setBusy(false);}}
  }
  async function saveDuration(id: string) {
    if (actionLock.current || !facts || duration?.id !== id) return;
    const minutes = Number(duration.value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) { setError('请输入 1–240 的整数分钟'); return; }
    const token = generation.current;
    try {
      guard();
      actionLock.current = true;
      setBusy(true); setError('');
      const task = await store.getTask(id);
      if (token !== generation.current) return;
      if (!task || task.periodId !== facts.period.id || task.estimatedMinutes || !['TODO','DELAYED'].includes(task.status)) throw new Error('任务已变化，请刷新明日规划');
      await new TaskApplicationService(store).updateTask({taskId:id, changes:{estimatedMinutes:minutes}});
      const updated = await planner.read();
      if (token === generation.current) { setFacts(updated); setDuration(null); }
    } catch (e) { if (token === generation.current) setError((e as Error).message); }
    finally { if (token === generation.current) { actionLock.current=false; setBusy(false); } }
  }
  async function revise() {
    if(actionLock.current || !candidate || !edit)return;
    try{guard();}catch(e){setError((e as Error).message);return;}
    if(edit.date!==facts?.tomorrow || edit.startTime<start || edit.endTime>end){setError('请保持在明天明确的可用窗口内；其他日期请重新提供可用时间再生成');return;}
    actionLock.current=true;const token=++generation.current;setBusy(true);setError('');
    try {
      const next=await service.reviseSchedule(candidate.operation,edit,'在已声明的可用窗口内调整',{date:facts!.tomorrow,startTime:start,endTime:end});
      if(token!==generation.current){if(next.operation&&service.canCancel)await service.cancel(next.operation);return;}
      setCandidate(next);setEdit(null);
    }catch(e){if(token===generation.current)await restoreRevision(candidate,(e as Error).message,token);}
    finally{if(token===generation.current){actionLock.current=false;setBusy(false);}}
  }
  async function restoreRevision(previous: NonNullable<typeof candidate>, message: string, token: number) {
    try {
      const state=await service.readRevisionState(previous.operation);
      if(token!==generation.current)return;
      setRecovery(null);setEdit(null);
      if(state.validPending){setCandidate({...previous,operation:state.reference,proposal:{...previous.proposal,proposalId:state.record.providerProposalId,after:state.record.after,candidates:[state.record.after],createdAt:state.record.createdAt,expiresAt:state.record.expiresAt,reason:'已读取实际候选，请核对后确认'}});setError(message);}
      else{setCandidate(null);setError('候选已关闭、过期或执行，请核对日历后重新规划。');}
    }catch{
      if(token===generation.current){setCandidate(null);setEdit(null);setRecovery({reference:previous.operation!,previous});setError('候选状态尚未确认，需要重新读取；请勿重复生成或执行。');}
    }
  }
  async function rereadRevision() {
    if(actionLock.current||!recovery)return;
    try{guard();}catch(e){setError((e as Error).message);return;}
    actionLock.current=true;setBusy(true);const token=++generation.current;
    try{await restoreRevision(recovery.previous,'已重新读取候选状态，请核对。',token);}
    finally{if(token===generation.current){actionLock.current=false;setBusy(false);}}
  }
  async function endPreview() {
    if(actionLock.current || !candidate)return;
    try{guard();}catch(e){setError((e as Error).message);return;}
    actionLock.current=true;const token=++generation.current;setBusy(true);
    try{
      if(candidate.operation&&service.canCancel){const op=await service.inspectOperation(candidate.operation);if(op.status==='PENDING')await service.cancel(candidate.operation);}
      if(token===generation.current){setCandidate(null);setEdit(null);}
      const next=await planner.read();if(token===generation.current)setFacts(next);
    }catch(e){if(token===generation.current)setError((e as Error).message);}
    finally{if(token===generation.current){actionLock.current=false;setBusy(false);}}
  }
  const slot=candidate?.proposal.after;
  const matching = (facts?.recommendations ?? []).filter(row => row.task.title.toLowerCase().includes(query.trim().toLowerCase()));
  return <View style={{gap:8,width:'100%',maxWidth:760,alignSelf:'center',backgroundColor:theme.surface,borderRadius:14,padding:8}}>
    <Button label={open?'刷新明日规划事实':'从待办中规划明天'} variant="quiet" disabled={blocked||busy||!!candidate||!!recovery} onPress={()=>void load()} />
    {open?<View style={{gap:8}}>
      <AppText muted>选择明天的可用时间，再从待办中挑一项。</AppText>
      {facts?<><AppText>明天：{facts.tomorrow} · 已有 {facts.context.schedule?.events.filter(e=>e.date===facts.tomorrow).length ?? 0} 个固定或已安排时间块</AppText>
        <View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>
          {['09:00–12:00','14:00–18:00','19:00–21:00'].map(window => <Button key={window} label={window}
            variant="quiet" disabled={busy||!!candidate||!!recovery} onPress={() => {
              const [from,to] = window.split('–'); setStart(from); setEnd(to);
            }} />)}
        </View>
        <Field label="明天可用开始时间" value={start} onChangeText={setStart} placeholder="例如 14:00" editable={!busy&&!candidate} />
        <Field label="明天可用结束时间" value={end} onChangeText={setEnd} placeholder="例如 18:00" editable={!busy&&!candidate} />
        <Field label="时间偏好（可选）" value={preference} onChangeText={setPreference} editable={!busy&&!candidate} />
        {!candidate&&!recovery&&facts.recommendations.length>30?<AppText muted>共 {facts.recommendations.length} 项，每次展示前 30 项。输入名称可查找全部任务。</AppText>:null}
        {!candidate&&!recovery&&(facts.recommendations.length>30||query.length>0)?<Field label="查找全部任务" value={query} onChangeText={setQuery} />:null}
        {!candidate&&!recovery&&!matching.length&&query?<AppText>没有匹配的任务</AppText>:null}
        {!candidate&&!recovery?<View accessibilityLabel="明日推荐任务" style={{gap:12}}>{matching.slice(0,30).map(row=><View key={row.task.id}><AppText>{row.task.title}</AppText>{row.existingEvents?.length?<AppText muted>已有安排：{row.existingEvents.map(e=>`${e.startTime}–${e.endTime}`).join('、')}；仍可主动追加</AppText>:null}<AppText muted>{row.reason}</AppText>
          {!row.task.estimatedMinutes ? <><Field label={`预计分钟 · ${row.task.title}`} keyboardType="number-pad" maxLength={3}
            value={duration?.id === row.task.id ? duration.value : ''} onChangeText={value=>setDuration({id:row.task.id,value})} />
            <Button label="保存此任务时长" disabled={blocked||busy||duration?.id!==row.task.id} onPress={()=>void saveDuration(row.task.id)} /></>:null}
          <Button label={`为明天生成建议：${row.task.title}`} variant="quiet" disabled={blocked||busy||!start||!end||!row.task.estimatedMinutes} onPress={()=>void propose(row.task.id)} /></View>)}</View>:null}
        {!facts.recommendations.length?<AppText>没有可安排的未完成任务。</AppText>:null}
      </>:null}
      {busy?<AppText>正在读取或生成建议…</AppText>:null}
      {error?<AppText>{error}</AppText>:null}
      {recovery?<Button label="重新读取候选状态" disabled={busy||blocked} onPress={()=>void rereadRevision()} />:null}
      {candidate&&slot?<>
        <AppText>候选预览 · 尚未执行：{candidate.proposal.reason}</AppText>
        <WeeklyScheduleBoard weekStart={todayIso(startOfWeek(parseISO(slot.date),{weekStartsOn:1}))} events={[...(facts?.context.schedule?.events.filter(e=>e.date===slot.date).map(e=>({id:e.eventId,periodId:facts.period.id,taskId:e.kind==='COURSE'?null:e.taskId,type:e.kind,title:e.title,date:e.date,startTime:e.startTime,endTime:e.endTime,source:e.kind==='COURSE'?'SYSTEM':e.kind==='AI_ADJUSTMENT'?'AI':'USER'} as import('@/domain/scheduling/types').ScheduleEvent))??[]),{id:'preview-'+candidate.proposal.proposalId,periodId:facts!.period.id,taskId:candidate.proposal.taskId,type:'TASK',source:'USER',title:'候选 · '+(facts?.recommendations.find(r=>r.task.id===candidate.proposal.taskId)?.task.title ?? ''),...slot}]} />
        <Button label="修改候选时间" variant="quiet" disabled={busy||blocked||!candidate.operation} onPress={()=>setEdit({...slot})} />
        {edit?<><Field label="候选日期" value={edit.date} onChangeText={date=>setEdit({...edit,date})} /><Field label="候选开始时间" value={edit.startTime} onChangeText={startTime=>setEdit({...edit,startTime})} /><Field label="候选结束时间" value={edit.endTime} onChangeText={endTime=>setEdit({...edit,endTime})} />
          <Button label="重新校验候选" disabled={busy||blocked} onPress={()=>void revise()} /><Button label="取消编辑候选" disabled={busy||blocked} variant="quiet" onPress={()=>setEdit(null)} /></>:null}
        {candidate.operation?<TimeProposalCard onCancelled={()=>{setCandidate(null);setEdit(null);}} key={candidate.operation.operationId} store={store} blocked={blocked||busy} actionLock={actionLock} scope={facts?.period.id??''} onSaved={async()=>{const token=generation.current;const next=await planner.read();if(token===generation.current)setFacts(next);}} service={service} reference={candidate.operation} reason={candidate.proposal.reason} />:<AppText>当前空间只读，不能确认写入。</AppText>}
        <Button label="结束此候选预览" variant="quiet" disabled={busy} onPress={()=>void endPreview()} />
      </>:null}
      <Button label="收起明日规划" variant="quiet" disabled={busy||!!candidate||!!recovery} onPress={()=>{setOpen(false);onOpenChange?.(false);}} />
    </View>:null}
  </View>;
}
