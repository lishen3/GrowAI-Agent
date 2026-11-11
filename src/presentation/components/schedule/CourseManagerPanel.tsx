import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { GrowthStore } from '@/application/data/GrowthStore';
import { formatWeeks, weekdayLabel } from '@/domain/courses/parseCourseTableHtml';
import type { Course } from '@/domain/courses/types';
import type { Period } from '@/domain/periods/types';
import { AppText } from '@/presentation/components/AppText';
import { Button } from '@/presentation/components/Button';
import { Notice } from '@/presentation/components/Notice';
import { useTheme } from '@/presentation/theme/tokens';
import { CourseForm } from './CourseForm';

export function CourseManagerPanel({ period, store, onChanged, revision = 0, disabled = false, assertWritable }: {
  revision?: number;
  disabled?: boolean;
  assertWritable?: () => void;
  period: Period;
  store: GrowthStore;
  onChanged: () => void;
}) {
  const theme = useTheme();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Course | 'new' | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const load = useCallback(async () => {
    if (!store.courses) { setError('当前数据源尚不支持课程读取'); return; }
    try {
      setError(null);
      setCourses(await store.courses.list(period.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取课程失败');
    }
  }, [period.id, store]);
  useEffect(() => { void load(); }, [load, revision]);
  async function clearAll() {
    if (!store.courses || !courses?.length) return;
    setBusyId('all'); setError(null);
    try {
      for (const course of courses) { if (disabled) throw new Error('当前数据尚未验证'); assertWritable?.(); await store.courses.delete(period.id, course.id); }
      await load();
      onChanged();
      setConfirmClear(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '清空课程表失败');
    } finally { setBusyId(null); }
  }

  async function remove(course: Course) {
    if (!store.courses) return;
    setBusyId(course.id); setError(null);
    try {
      if (disabled) throw new Error('当前数据尚未验证'); assertWritable?.();
      await store.courses.delete(period.id, course.id);
      await load();
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除课程失败');
    } finally { setBusyId(null); }
  }
  return <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
    <AppText variant="heading">课程表 · 固定课程</AppText>
    <AppText variant="caption" muted>课程在有效期内按周重复显示；删除课程不会删除任务或临时日程。</AppText>
    <View style={styles.actions}>
      <Button label={editing === 'new' ? '正在手动添加…' : '手动添加课程'} variant="secondary"
        disabled={disabled || busyId !== null || editing === 'new'} onPress={() => setEditing('new')} />
      {courses?.length ? <Button label={confirmClear ? '再次点击确认清空' : '清空课程表'} variant="quiet"
        disabled={disabled || busyId !== null} onPress={() => { if (confirmClear) void clearAll(); else setConfirmClear(true); }} /> : null}
      {confirmClear ? <Button label="取消清空" variant="quiet" disabled={disabled || busyId !== null}
        onPress={() => setConfirmClear(false)} /> : null}
    </View>
    {error ? <Notice title="课程读取失败">{error}</Notice> : null}
    {courses === null ? <AppText variant="caption" muted>正在读取…</AppText>
      : courses.length === 0 ? <AppText variant="caption" muted>还没有课程。可以导入学期课程表，或手动添加一门固定课程。</AppText>
        : courses.map((course) => <View key={course.id} style={[styles.row, { borderColor: theme.border }]}>
          <View style={styles.text}>
            <AppText variant="label">{course.name}</AppText>
            <AppText variant="caption" muted>
              {weekdayLabel(course.weekday)} {course.startTime}–{course.endTime} · {formatWeeks(course.weeks ?? [])}
              {course.teacher ? ` · ${course.teacher}` : ''}{course.location ? ` · ${course.location}` : ''}
            </AppText>
          </View>
          <Button label="编辑" variant="secondary" disabled={disabled || busyId !== null} onPress={() => setEditing(course)} />
          <Button label={busyId === course.id ? '删除中…' : '删除'} variant="quiet"
            disabled={disabled || busyId !== null} onPress={() => void remove(course)} />
        </View>)}
    {editing !== null ? <CourseForm disabled={disabled} assertWritable={assertWritable} period={period} store={store} course={editing === 'new' ? undefined : editing}
      onCancel={() => setEditing(null)} onSaved={() => {
        setEditing(null); void load(); onChanged();
      }} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  text: { flex: 1, gap: 2 },
});
