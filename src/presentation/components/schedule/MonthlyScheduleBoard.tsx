import { useState } from 'react';
import { Modal, ScrollView, Pressable, View } from 'react-native';
import { addDays, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { todayIso } from '@/shared/date';
import type { ScheduleEvent } from '@/domain/scheduling/types';
import type { LongTermGoal } from '@/domain/goals/types';
import { calendarDrop } from '@/domain/scheduling/calendarInteraction';
import { AppText } from '../AppText';
import { CalendarEventGesture } from './CalendarEventGesture';
import { useTheme } from '@/presentation/theme/tokens';

export function MonthlyScheduleBoard({ selectedDate, events, goals, startDate, endDate, disabled, onDate, onEvent, onChange, onError }: {
  selectedDate: string; events: ScheduleEvent[]; goals: LongTermGoal[]; startDate: string; endDate: string; disabled: boolean;
  onDate: (date: string) => void; onEvent: (event: ScheduleEvent) => void;
  onChange: (before: ScheduleEvent, after: ScheduleEvent) => Promise<void>; onError: (text: string) => void;
}) {
  const [expanded,setExpanded] = useState<string | null>(null);
  const theme = useTheme(); const [width, setWidth] = useState(350);
  const first = startOfWeek(startOfMonth(parseISO(selectedDate)), { weekStartsOn: 1 });
  const month = selectedDate.slice(0, 7); const dates = Array.from({ length: 42 }, (_,i) => todayIso(addDays(first,i)));
  return <View accessibilityLabel="月时间表" onLayout={e => setWidth(e.nativeEvent.layout.width)}>
    <View style={{ flexDirection: 'row' }}>{['一','二','三','四','五','六','日'].map(day => <AppText key={day} style={{width:'14.2857%',textAlign:'center'}}>周{day}</AppText>)}</View>
    {Array.from({length:6},(_,week)=><View key={week} style={{flexDirection:'row'}}>{dates.slice(week*7,week*7+7).map(date=>{
      const dayEvents = events.filter(event => event.date === date);
      const dueGoals = goals.filter(goal => goal.planning?.endDate === date);
      const previewRows = 3;
      const hiddenCount = dayEvents.length + dueGoals.length - previewRows;
      return <View key={date} style={{width:'14.2857%',height:150,borderWidth:1,borderColor:date===selectedDate?theme.primary:theme.border,backgroundColor:date===selectedDate?theme.primarySoft:theme.background}}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${date} 创建任务`} disabled={disabled || date<startDate || date>endDate || date.slice(0,7)!==month} onPress={()=>onDate(date)} style={{minHeight:32}}><AppText muted={date.slice(0,7)!==month}>{date.slice(8)}</AppText></Pressable>
      {dueGoals.slice(0,Math.max(0,previewRows-dayEvents.length)).map(goal=><AppText key={goal.id} variant="caption" numberOfLines={1}>到期：{goal.title}</AppText>)}
      {dayEvents.slice(0,previewRows).map(event=><CalendarEventGesture key={event.id} event={event} disabled={disabled} resize={false} onCommit={onChange} onError={onError}
        candidate={(dx,dy)=>{const after=calendarDrop(event,Math.round(dx/(width/7))+Math.round(dy/150)*7,0);if(after.date.slice(0,7)!==month)throw new Error('当前仅支持同月拖动，请用详情修改跨月日期');return after;}}
        style={{position:'relative',minHeight:28,backgroundColor:theme.surfaceStrong,marginBottom:2}}>
        <Pressable style={{width:'100%',minWidth:0,overflow:'hidden'}} accessibilityRole="button" accessibilityLabel={`${event.title} ${event.date} ${event.startTime}`} onPress={()=>onEvent(event)} disabled={disabled}><AppText variant="caption" numberOfLines={1}>{event.startTime} {event.title}</AppText></Pressable>
      </CalendarEventGesture>)}
      {hiddenCount>0 ? <Pressable accessibilityRole="button" accessibilityLabel={`${date} 查看更多日程`} onPress={()=>setExpanded(date)}><AppText variant="caption" numberOfLines={1}>+{hiddenCount} 项</AppText></Pressable>:null}
    </View>;})}</View>)}
    <Modal visible={expanded!==null} transparent onRequestClose={()=>setExpanded(null)}>
      <View style={{flex:1,justifyContent:'center',padding:20,backgroundColor:'rgba(0,0,0,0.25)'}}><ScrollView style={{flexGrow:0,maxHeight:'80%',backgroundColor:theme.background,borderRadius:16}} contentContainerStyle={{padding:16,gap:12}}>
        <AppText>日程列表 · {expanded}</AppText>
        {events.filter(event=>event.date===expanded).map(event=><Pressable key={event.id} accessibilityRole="button" accessibilityLabel={`查看日程 ${event.title} ${event.startTime}`} onPress={()=>{setExpanded(null);onEvent(event);}}><AppText>{event.startTime}–{event.endTime} {event.title}</AppText></Pressable>)}
        {goals.filter(goal=>expanded && goal.planning?.endDate===expanded).map(goal=><AppText key={goal.id}>到期：{goal.title}</AppText>)}
        <Pressable accessibilityRole="button" accessibilityLabel="关闭日程列表" onPress={()=>setExpanded(null)}><AppText>关闭日程列表</AppText></Pressable>
      </ScrollView></View>
    </Modal>
  </View>;
}
