import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import type { GrowthStore } from '@/application/data/GrowthStore';
import { CourseImportService } from '@/application/courses/CourseImportService';
import { parsePdfCourseTable } from '@/application/courses/PdfCourseImportService';
import { mapCourseTeachingWeeks, suggestedTeachingMonday } from '@/domain/courses/courseTeachingWeeks';
import { formatWeeks, parseCourseTableHtml, weekdayLabel, type CourseTableParseResult } from '@/domain/courses/parseCourseTableHtml';
import type { Period } from '@/domain/periods/types';
import { calculatePeriodWeek } from '@/shared/date';
import { AppText } from '@/presentation/components/AppText';
import { Button } from '@/presentation/components/Button';
import { Field } from '@/presentation/components/Field';
import { Notice } from '@/presentation/components/Notice';
import { useTheme } from '@/presentation/theme/tokens';

function minutesOf(value: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

function timeOf(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function buildPeriodTimes(morning: string, afternoon: string, evening: string,
  durationText: string, breakText: string): Array<{ startTime: string; endTime: string }> | null {
  const starts = [minutesOf(morning), minutesOf(afternoon), minutesOf(evening)];
  const duration = Number(durationText);
  const gap = Number(breakText);
  if (starts.some((value) => value === null) || !Number.isInteger(duration) || duration < 20 || duration > 180
    || !Number.isInteger(gap) || gap < 0 || gap > 60) return null;
  const span = 4 * duration + 3 * gap;
  if (starts.some((start, index) => start! + span >= 24 * 60 ||
    (index < starts.length - 1 && start! + span > starts[index + 1]!))) return null;
  return starts.flatMap((base) => Array.from({ length: 4 }, (_, index) => {
    const start = base! + index * (duration + gap);
    return { startTime: timeOf(start), endTime: timeOf(start + duration) };
  }));
}

export function CourseImportPanel({ period, store, onImported, disabled: writesDisabled = false, assertWritable }: {
  disabled?: boolean;
  assertWritable?: () => void;
  period: Period;
  store: GrowthStore;
  onImported: () => void;
}) {
  const theme = useTheme();
  const [html, setHtml] = useState('');
  const [parsed, setParsed] = useState<CourseTableParseResult | null>(null);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [source, setSource] = useState<string>('HTML');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const importing = useRef(false);
  const [morningStart, setMorningStart] = useState('08:00');
  const [afternoonStart, setAfternoonStart] = useState('14:00');
  const [eveningStart, setEveningStart] = useState('19:00');
  const [classMinutes, setClassMinutes] = useState('45');
  const [breakMinutes, setBreakMinutes] = useState('10');
  const [periodOverride, setPeriodOverride] = useState('');
  const [firstTeachingMonday, setFirstTeachingMonday] = useState(() => suggestedTeachingMonday(period));
  const totalWeeks = calculatePeriodWeek(period.startDate, period.endDate, period.endDate, period.weekStartsOn);

  function importOptions() {
    mapCourseTeachingWeeks(period, 1, firstTeachingMonday, []);
    const periodTimes = periodTimesOrError();
    if (!periodTimes) return null;
    const semesterWeeks = calculatePeriodWeek(firstTeachingMonday, period.endDate, period.endDate, 1);
    return { semesterWeeks, periodTimes };
  }

  function parsePeriodOverride(value: string): Array<{ startTime: string; endTime: string }> | null {
    const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return null;
    if (lines.length !== 12) return null;
    const result: Array<{ startTime: string; endTime: string }> = [];
    for (const line of lines) {
      const match = /^((?:[01]\d|2[0-3]):[0-5]\d)-((?:[01]\d|2[0-3]):[0-5]\d)$/.exec(line);
      if (!match || match[1] >= match[2] || (result.length && match[1] < result[result.length - 1].endTime)) return null;
      const [, startTime, endTime] = match;
      result.push({ startTime, endTime });
    }
    return result;
  }

  function periodTimesOrError() {
    if (periodOverride.trim()) {
      const custom = parsePeriodOverride(periodOverride);
      if (!custom) {
        setError('请按顺序填写 12 行 HH:mm-HH:mm，每节结束须晚于开始，各节不能重叠');
        return null;
      }
      return custom;
    }
    const times = buildPeriodTimes(morningStart, afternoonStart, eveningStart, classMinutes, breakMinutes);
    if (!times) setError('节次时间模板无效：上午/下午/晚上开始时间应为 HH:mm，每节 20–180 分钟，课间 0–60 分钟，且不能跨日');
    return times;
  }

  function changeTemplate(setter: (value: string) => void) {
    return (value: string) => {
      setter(value); setParsed(null); setSkipped(new Set()); setError(null); setMessage(null);
    };
  }

  function parse(value: string) {
    setHtml(value);
    setMessage(null);
    setError(null);
    setSource('HTML');
    setSkipped(new Set());
    try {
      const options = importOptions();
      if (!options) { setParsed(null); return; }
      setParsed(parseCourseTableHtml(value, options));
    } catch (caught) {
      setParsed(null);
      setError(caught instanceof Error ? caught.message : '解析失败');
    }
  }

  function pickFile(accept: string, handle: (file: File) => void) {
    if (typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) handle(file);
    };
    input.style.display = 'none';
    document.body.appendChild(input);
    input.click();
    window.setTimeout(() => input.remove(), 0);
  }

  function chooseHtml() {
    pickFile('.html,.htm,text/html', (file) => {
      void file.text().then((text) => parse(text)).catch(() => setError('无法读取所选文件'));
    });
  }

  async function parsePdfFile(file: File) {
    setBusy(true); setMessage(null); setError(null); setParsed(null); setSource('PDF');
    setSkipped(new Set());
    try {
      const options = importOptions();
      if (!options) return;
      const result = await parsePdfCourseTable(file, options);
      setParsed(result);
      setSource(`PDF · ${result.pages} 页`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'PDF 解析失败，请改用 HTML 或手动录入');
    } finally { setBusy(false); }
  }

  function choosePdf() {
    pickFile('.pdf,application/pdf', (file) => { void parsePdfFile(file); });
  }

  async function importCourses() {
    if (writesDisabled || importing.current) return;
    if (!parsed?.courses.length || !store.courses) return;
    const selected = parsed.courses.filter((_, index) => !skipped.has(index));
    if (!selected.length) { setError('请至少保留一门课程再导入'); return; }
    importing.current = true;
    setBusy(true); setError(null); setMessage(null);
    try {
      assertWritable?.();
      const result = await new CourseImportService(store.courses).import(period, selected, assertWritable, firstTeachingMonday);
      const pieces = [`已导入 ${result.created.length} 门课程`];
      const duplicates = result.skipped - result.outsidePeriod;
      if (duplicates) pieces.push(`跳过 ${duplicates} 门重复课程`);
      if (result.outsidePeriod) pieces.push(`${result.outsidePeriod} 门的教学周全部在当前阶段以外`);
      for (const failure of result.failed) pieces.push(`${failure.name} 导入失败：${failure.error}`);
      if (result.warnings.length) pieces.push(result.warnings.join('；'));
      setMessage(pieces.join('；'));
      if (result.created.length) onImported();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '导入失败');
    } finally { importing.current = false; setBusy(false); }
  }

  const keptCount = parsed ? parsed.courses.filter((_, index) => !skipped.has(index)).length : 0;

  return <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
    <AppText variant="heading">导入学期课程表</AppText>
    <AppText variant="caption" muted>
      支持教务系统导出的 HTML 表格或文字型 PDF。请按校历核对第一周的周一，课程会按上课日期显示在当前阶段。
    </AppText>
    <Field label="教学第 1 周的周一" value={firstTeachingMonday} maxLength={10}
      placeholder="YYYY-MM-DD" editable={!busy} onChangeText={changeTemplate(setFirstTeachingMonday)} />
    <View style={styles.template}>
      <AppText variant="label">节次时间模板</AppText>
      <AppText variant="caption" muted>
        PDF 里可能只有“第X节”而没有具体时间。这里的时间会用于所有节次；如果不对，先改这里再重新选择文件。上午 1–4 节、下午 5–8 节、晚上 9–12 节。
      </AppText>
      <View style={styles.templateRow}>
        <View style={styles.templateField}><Field label="上午第1节" value={morningStart}
          onChangeText={changeTemplate(setMorningStart)} maxLength={5} editable={!busy} /></View>
        <View style={styles.templateField}><Field label="下午第5节" value={afternoonStart}
          onChangeText={changeTemplate(setAfternoonStart)} maxLength={5} editable={!busy} /></View>
        <View style={styles.templateField}><Field label="晚上第9节" value={eveningStart}
          onChangeText={changeTemplate(setEveningStart)} maxLength={5} editable={!busy} /></View>
      </View>
      <View style={styles.templateRow}>
        <View style={styles.templateField}><Field label="每节分钟" value={classMinutes}
          onChangeText={changeTemplate(setClassMinutes)} maxLength={3} editable={!busy} /></View>
        <View style={styles.templateField}><Field label="课间分钟" value={breakMinutes}
          onChangeText={changeTemplate(setBreakMinutes)} maxLength={2} editable={!busy} /></View>
      </View>
      <Field label="自定义 1–12 节时间（可选，每行 HH:mm-HH:mm）" value={periodOverride}
        onChangeText={changeTemplate(setPeriodOverride)} multiline
        placeholder={'08:00-08:45\n08:55-09:40\n…共 12 行；留空则用上面的模板'}
        editable={!busy} />
    </View>
    {typeof document !== 'undefined' ? <>
      <Button label="选择 HTML 文件" variant="secondary" disabled={writesDisabled || busy} onPress={chooseHtml} />
      <Button label={busy ? '正在解析 PDF…' : '选择 PDF 文件'} variant="secondary" disabled={writesDisabled || busy} onPress={choosePdf} />
      <AppText variant="caption" muted>PDF 仅支持文字型文件；扫描件/图片型 PDF 需要 OCR，当前版本会提示无法解析。</AppText>
    </> : null}
    <TextInput value={html} onChangeText={parse} multiline editable={!busy}
      placeholder="也可以把课程表 HTML 源码粘贴到这里"
      placeholderTextColor={theme.textMuted}
      style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceStrong }]} />
    {error ? <Notice title="课程表解析失败">{error}</Notice> : null}
    {message ? <Notice title="导入结果">{message}</Notice> : null}
    {parsed && source.startsWith('PDF') ? <Notice title="核对上课时间">
      原表只写节次时，预览会采用上方的节次时间模板。若与学校作息不符，请先修改模板，再重新选择 PDF。
    </Notice> : null}
    {parsed ? <View style={styles.preview}>
      <AppText variant="label">
        {source} · {parsed.tableCount} 张表 · 识别 {parsed.courses.length} 门课程 · 当前阶段共 {totalWeeks} 周
      </AppText>
      <AppText variant="caption" muted>阶段从 {period.startDate} 到 {period.endDate}。同课、同地点和时段的不同教学周会合并显示。</AppText>
      {parsed.warnings.map((warning) => <AppText key={warning} variant="caption" muted>提示：{warning}</AppText>)}
      <AppText variant="caption" muted>逐项核对；不需要的课程点“跳过”，不会写入本地数据库。</AppText>
      <ScrollView style={styles.previewList} nestedScrollEnabled>
      {parsed.courses.map((course, index) => {
        const disabled = skipped.has(index);
        return <Pressable key={`${course.name}:${course.weekday}:${course.startTime}:${index}`}
          accessibilityRole="checkbox" accessibilityState={{ checked: !disabled }} disabled={writesDisabled || busy}
          onPress={() => setSkipped((old) => {
            const next = new Set(old);
            if (next.has(index)) next.delete(index); else next.add(index);
            return next;
          })}
          style={[styles.row, { borderColor: theme.border, opacity: disabled ? 0.45 : 1 }]}>
          <AppText variant="label">{disabled ? '☐ 跳过' : '☑ 导入'} · {course.name}</AppText>
          <AppText variant="caption" muted>
            {weekdayLabel(course.weekday)} {course.startTime}–{course.endTime} · {formatWeeks(course.weeks)}
            {course.teacher ? ` · ${course.teacher}` : ''}{course.location ? ` · ${course.location}` : ''}
          </AppText>
        </Pressable>;
      })}
      </ScrollView>
      <Button label={busy ? '正在导入…' : `导入选中的 ${keptCount} 门课程`}
        loading={busy} disabled={writesDisabled || busy || !keptCount || !store.courses} onPress={() => void importCourses()} />
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  input: { minHeight: 96, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14, textAlignVertical: 'top' },
  template: { gap: 8 },
  templateRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  templateField: { flex: 1, minWidth: 110 },
  preview: { gap: 8 },
  previewList: { maxHeight: 420 },
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 2 },
});
