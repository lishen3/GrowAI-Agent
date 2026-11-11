import { useRef, useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import type { GrowthStore } from '@/application/data/GrowthStore';
import type { Period } from '@/domain/periods/types';
import type { Task } from '@/domain/tasks/types';
import type { ScheduleEvent } from '@/domain/scheduling/types';
import { CreateScheduledTaskService } from '@/application/scheduling/CreateScheduledTaskService';
import { createId } from '@/shared/id';
import { AppText } from '../AppText';
import { Button } from '../Button';
import { Field } from '../Field';
import { NewScheduledTaskForm } from './NewScheduledTaskForm';
import { ScheduleEventForm } from '@/components/scheduling/ScheduleEventForm';
import { useTheme } from '@/presentation/theme/tokens';

export function CalendarTaskDialog({ slot, store, period, tasks, initialTaskId, initialMode, onCreateExisting, disabled, assertWritable, onClose, onSaved }: {
  slot: Pick<ScheduleEvent,'date'|'startTime'|'endTime'>; store: GrowthStore; period: Period; tasks: Task[]; initialTaskId?: string;
  initialMode?: 'new'|'existing'; onCreateExisting: (input: import('@/domain/scheduling/types').CreateScheduleEvent, requestId: string) => Promise<unknown>;
  disabled: boolean; assertWritable: () => void; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const timeSlot={date:slot.date,startTime:slot.startTime,endTime:slot.endTime};
  const theme = useTheme(); const [mode,setMode] = useState<'new'|'existing'>(initialMode??(initialTaskId?'existing':'new'));
  const [search,setSearch] = useState(''); const [id,setId] = useState(initialTaskId ?? '');
  const requestId = useRef(createId('manual'));
  const task = tasks.find(t=>t.id===id && t.periodId===period.id && !['DONE','CANCELLED'].includes(t.status));
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}><View style={{flex:1,justifyContent:'center',alignItems:'center',padding:16,backgroundColor:'rgba(0,0,0,0.25)'}}>
    <ScrollView style={{flexGrow:0,width:'100%',maxWidth:716,maxHeight:'90%',backgroundColor:theme.background,borderRadius:16}} contentContainerStyle={{padding:16,gap:12}} keyboardShouldPersistTaps="handled">
      <View style={{flexDirection:'row',gap:8}}><Button label="创建新任务" variant={mode==='new'?'primary':'quiet'} disabled={disabled} onPress={()=>setMode('new')} /><Button label="安排已有任务" variant={mode==='existing'?'primary':'quiet'} disabled={disabled} onPress={()=>setMode('existing')} /></View>
      {mode==='new'?<NewScheduledTaskForm slot={timeSlot} disabled={disabled} goalContext={{store,period}} onCancel={onClose}
        onSubmit={async(input,target,request)=>{assertWritable();const result=await new CreateScheduledTaskService(store).createAtomic(period.id,input,target,request!);await onSaved();return result;}} />:<>
        <Field label="搜索已有任务" value={search} onChangeText={setSearch} placeholder="任务名称" />
        {tasks.filter(t=>t.periodId===period.id && !['DONE','CANCELLED'].includes(t.status) && t.title.includes(search)).map(t=><Button key={t.id} label={`${t.title} · ${t.status}`} variant="quiet" disabled={disabled} onPress={()=>{setId(t.id);requestId.current=createId('manual');}} />)}
        {task?<ScheduleEventForm key={task.id} task={task} period={period} defaultSlot={timeSlot} disabled={disabled} onCancel={onClose}
          onSubmit={async input=>{assertWritable();await onCreateExisting(input,requestId.current);await onSaved();}} />:<AppText muted>选择一个任务；已有时间块会保留。</AppText>}
        <Button label="关闭创建弹窗" variant="quiet" onPress={onClose} />
      </>}
    </ScrollView>
  </View></Modal>;
}
