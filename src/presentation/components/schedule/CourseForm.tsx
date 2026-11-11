import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { GrowthStore } from '@/application/data/GrowthStore';
import { CourseApplicationService } from '@/application/courses/CourseApplicationService';
import { formatWeeks, maxWeekExpression, parseWeekExpression, weekdayLabel } from '@/domain/courses/parseCourseTableHtml';
import type { Course } from '@/domain/courses/types';
import type { Period } from '@/domain/periods/types';
import { calculatePeriodWeek } from '@/shared/date';
import { AppText } from '@/presentation/components/AppText';
import { Button } from '@/presentation/components/Button';
import { ChoiceChip } from '@/presentation/components/ChoiceChip';
import { Field } from '@/presentation/components/Field';
import { Notice } from '@/presentation/components/Notice';
import { ScreenSection } from '@/presentation/components/Screen';

export function CourseForm({ period, store, course, onSaved, onCancel, disabled = false, assertWritable }: {
  disabled?: boolean;
  assertWritable?: () => void;
  period: Period;
  store: GrowthStore;
  course?: Course;
  onSaved: (course: Course) => void;
  onCancel: () => void;
}) {
  const totalWeeks = calculatePeriodWeek(period.startDate, period.endDate, period.endDate, period.weekStartsOn);
  const [name, setName] = useState(course?.name ?? '');
  const [weekday, setWeekday] = useState(course?.weekday ?? 1);
  const [startTime, setStartTime] = useState(course?.startTime ?? '08:00');
  const [endTime, setEndTime] = useState(course?.endTime ?? '09:40');
  const [weeks, setWeeks] = useState(course?.weeks?.length ? formatWeeks(course.weeks) : '');
  const [teacher, setTeacher] = useState(course?.teacher ?? '');
  const [location, setLocation] = useState(course?.location ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);

  async function submit() {
    if (disabled || lock.current) return;
    lock.current = true; setSaving(true); setError(null);
    try {
      assertWritable?.();
      if (!store.courses) throw new Error('当前数据源尚不支持课程');
      if (!name.trim()) throw new Error('请输入课程名称');
      const parsedWeeks = weeks.trim() ? parseWeekExpression(weeks, totalWeeks) : [];
      if (weeks.trim() && !parsedWeeks.length) throw new Error('周次格式无法识别，请写“每周”“1-16”或“单周/双周”');
      const explicitMax = maxWeekExpression(weeks);
      if (explicitMax !== null && explicitMax > totalWeeks) {
        throw new Error(`周次不能超过当前阶段的总周数（${totalWeeks} 周）`);
      }
      const service = new CourseApplicationService(store.courses);
      const input = {
        name: name.trim(), weekday, startTime, endTime,
        teacher: teacher.trim() || undefined, location: location.trim() || undefined,
        validFrom: period.startDate, validUntil: period.endDate,
        // Empty array explicitly means "every week" and also clears an existing week restriction.
        weeks: parsedWeeks,
      };
      const saved = course
        ? await service.updateCourse(period.id, course.id, input)
        : await service.createCourse({ ...input, periodId: period.id });
      onSaved(saved);
    } catch (caught) {
      const issues = (caught as { issues?: { message: string }[] })?.issues;
      setError(issues?.map((issue) => issue.message).join('；')
        ?? (caught instanceof Error ? caught.message : '保存课程失败，请检查输入'));
    } finally { lock.current = false; setSaving(false); }
  }

  return <ScreenSection>
    <AppText variant="heading">{course ? `编辑课程 · ${course.name}` : '手动添加课程'}</AppText>
    <AppText variant="caption" muted>
      固定课程会在有效期内每周重复显示。周次留空表示每周；也可以写 1-16、1-8,10-16、单周或双周。
    </AppText>
    <Field label="课程名称" value={name} onChangeText={setName} placeholder="例如：高等数学" maxLength={60} editable={!saving} />
    <View style={styles.chips}>
      {[1, 2, 3, 4, 5, 6, 7].map((value) => <ChoiceChip key={value} label={weekdayLabel(value)}
        selected={weekday === value} onPress={() => setWeekday(value)} />)}
    </View>
    <View style={styles.times}>
      <View style={styles.timeField}><Field label="开始（HH:mm）" value={startTime} onChangeText={setStartTime}
        placeholder="08:00" maxLength={5} editable={!saving} /></View>
      <View style={styles.timeField}><Field label="结束（HH:mm）" value={endTime} onChangeText={setEndTime}
        placeholder="09:40" maxLength={5} editable={!saving} /></View>
    </View>
    <Field label={`周次（当前阶段共 ${totalWeeks} 周）`} value={weeks} onChangeText={setWeeks}
      placeholder="留空=每周；或 1-16、单周、双周" maxLength={120} editable={!saving} />
    <View style={styles.times}>
      <View style={styles.timeField}><Field label="教师（可选）" value={teacher} onChangeText={setTeacher} maxLength={80} editable={!saving} /></View>
      <View style={styles.timeField}><Field label="地点（可选）" value={location} onChangeText={setLocation} maxLength={120} editable={!saving} /></View>
    </View>
    {error ? <Notice title="未能保存课程">{error}</Notice> : null}
    <Button label={course ? '保存课程修改' : '添加课程'} loading={saving} disabled={disabled || saving || !name.trim()} onPress={() => void submit()} />
    <Button label="取消" variant="quiet" disabled={saving} onPress={onCancel} />
  </ScreenSection>;
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  times: { flexDirection: 'row', gap: 10 },
  timeField: { flex: 1 },
});
