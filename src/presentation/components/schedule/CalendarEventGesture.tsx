import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, PanResponder, View, type ViewStyle } from 'react-native';
import { createElement } from 'react';
import type { ScheduleEvent } from '@/domain/scheduling/types';
import { AppText } from '../AppText';

/** Preview only while dragging; one conditional application write on release. Escape/cancel never commits. */
export function CalendarEventGesture({ event, disabled, style, children, candidate, onCommit, onError, resize = true }: {
  event: ScheduleEvent; disabled: boolean; style?: ViewStyle; children: ReactNode;
  candidate: (dx: number, dy: number, resize: boolean) => ScheduleEvent;
  onCommit?: (before: ScheduleEvent, after: ScheduleEvent) => Promise<void>;
  onError?: (text: string) => void; resize?: boolean;
}) {
  const [preview, setPreview] = useState<{ dx: number; dy: number; after?: ScheduleEvent; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ x: number; y: number; resize: boolean; armed: boolean; moved: boolean; before: ScheduleEvent; calculate: typeof candidate; commit: typeof onCommit } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); drag.current = null; }, []);
  const proposal = useRef<typeof preview>(null);
  const latest = useRef({ event, disabled, candidate, onCommit, onError }); latest.current = { event, disabled, candidate, onCommit, onError };
  const canDrag = !disabled && !saving && !!onCommit && event.source === 'USER' && event.type !== 'COURSE';
  function cancel() { if (timer.current) clearTimeout(timer.current); timer.current = null; drag.current = null; proposal.current = null; setPreview(null); }
  const sameTime = (a: ScheduleEvent,b: ScheduleEvent) => a.date===b.date && a.startTime===b.startTime && a.endTime===b.endTime;
  function cancelGesture() { if(drag.current)suppressClick.current=true; cancel(); }
  function move(dx: number, dy: number) {
    if (!drag.current?.armed || latest.current.disabled) return;
    if (Math.abs(dx) + Math.abs(dy) < 5 && !drag.current.moved) return;
    try {
      const after=drag.current.calculate(dx,dy,drag.current.resize);
      if(sameTime(drag.current.before,after)){proposal.current=null;setPreview(null);return;}
      drag.current.moved=true;proposal.current={dx,dy,after};
    }
    catch (e) { drag.current.moved=true; proposal.current = { dx, dy, error: e instanceof Error ? e.message : '目标无效' }; }
    setPreview(proposal.current);
  }
  async function release() {
    const value = proposal.current; const started = drag.current; const moved = started?.moved; if (moved) suppressClick.current = true; cancel();
    if (!moved || !value) return;
    if (value.error) { latest.current.onError?.(value.error); return; }
    if (!value.after || latest.current.disabled || sameTime(started!.before,value.after)) return;
    setSaving(true);
    try { await started?.commit?.(started.before, value.after); }
    catch (e) { latest.current.onError?.(e instanceof Error ? e.message : '保存失败，已恢复原位置'); }
    finally { setSaving(false); }
  }
  const native = useRef(Platform.OS === 'web' ? null : PanResponder.create({
    onMoveShouldSetPanResponder: () => !!drag.current?.armed,
    onPanResponderMove: (_e, g) => move(g.dx, g.dy),
    onPanResponderRelease: () => { void release(); }, onPanResponderTerminate: cancelGesture,
  })).current;
  const contents = <>{children}{saving ? <AppText variant="caption">保存中…</AppText> : null}
    {preview ? <View style={{ position: 'absolute', top: 0, left: 0, minWidth: 110, backgroundColor: '#fffdf7', zIndex: 50 }}><AppText variant="caption">{preview.error ?? `${preview.after?.date} ${preview.after?.startTime}–${preview.after?.endTime}`}</AppText></View> : null}
    {canDrag && resize ? Platform.OS === 'web' ? createElement('div', { 'data-resize': 'true', 'aria-label': `调整时长 ${event.title}`, style: { position:'absolute',left:0,right:0,bottom:0,height:10,backgroundColor:'#326b5040',cursor:'ns-resize' } }) : <View onTouchStart={e=>{e.stopPropagation();drag.current={x:0,y:0,resize:true,armed:true,moved:false,before:event,calculate:candidate,commit:onCommit};}} style={{position:'absolute',left:0,right:0,bottom:0,height:10,backgroundColor:'#326b5040'}} /> : null}</>;
  if (Platform.OS === 'web') return createElement('div', {
    'data-calendar-event': event.id, style: { display:'flex', flexDirection:'column', minWidth:0, boxSizing:'border-box', ...style, transform: preview ? `translate(${preview.dx}px,${preview.dy}px)` : undefined, zIndex: preview ? 40 : 1, userSelect: 'none', touchAction: canDrag ? 'none' : 'auto' },
    onPointerDown: (e: any) => {
      if (!canDrag || e.button !== 0) return;
      suppressClick.current=false;
      const isResize = !!e.target.closest('[data-resize]');
      if(isResize)e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, resize: isResize, armed: isResize || e.pointerType !== 'touch', moved: false, before: event, calculate: candidate, commit: onCommit };
      if (e.pointerType === 'touch' && !isResize) timer.current = setTimeout(() => { if (drag.current) drag.current.armed = true; }, 500);
      // Capture only after a drag starts; capturing on down retargets a normal button click.
    },
    onPointerMove: (e: any) => { if (!drag.current) return; const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
      if (!drag.current.armed && Math.abs(dx) + Math.abs(dy) > 8) { cancelGesture(); return; }
      if (drag.current.armed) { move(dx,dy); if(drag.current?.moved && !e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.setPointerCapture(e.pointerId); }
    },
    onPointerUp: () => { void release(); }, onPointerCancel: cancelGesture,
    onClickCapture: (e: any) => { if (suppressClick.current || preview || saving) { suppressClick.current=false; e.preventDefault(); e.stopPropagation(); } },
    onKeyDown: (e: any) => { if (e.key === 'Escape') cancelGesture(); }, tabIndex: canDrag ? 0 : undefined,
  }, contents);
  return <View {...native?.panHandlers} style={[style, preview ? { transform: [{ translateX: preview.dx }, { translateY: preview.dy }], zIndex: 40 } : undefined]}
    onTouchStart={() => { if (canDrag) { drag.current = { x: 0, y: 0, resize: false, armed: false, moved: false, before: event, calculate: candidate, commit: onCommit }; timer.current = setTimeout(() => { if (drag.current) drag.current.armed = true; }, 500); } }}
    onTouchEnd={() => { if (!drag.current?.moved) cancel(); }}>{contents}</View>;
}
