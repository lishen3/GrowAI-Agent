/**
 * Best-effort parser for university timetable HTML tables.
 *
 * The importer deliberately does not use the DOM so it can run in tests and on
 * native builds. It understands the common shape: one table, a weekday header
 * row, period/time rows, and cells containing course name / teacher / weeks /
 * location separated by <br> or block elements. Anything uncertain is reported
 * as a warning and shown in the preview before the user confirms the import.
 */

export type ParsedCourseDraft = {
  name: string;
  teacher: string | null;
  location: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
  weeks: number[];
  evidence: string;
};

export type CourseTableParseResult = {
  courses: ParsedCourseDraft[];
  warnings: string[];
  tableCount: number;
};

export type CourseTableParseOptions = {
  /** Number of weeks in the current semester; used to cap/expand week rules. */
  semesterWeeks?: number;
  /** Period start/end times used when the table only has 第X节 labels. */
  periodTimes?: Array<{ startTime: string; endTime: string }>;
};

export const DEFAULT_PERIOD_TIMES = [
  { startTime: '08:00', endTime: '08:45' },
  { startTime: '08:55', endTime: '09:40' },
  { startTime: '10:00', endTime: '10:45' },
  { startTime: '10:55', endTime: '11:40' },
  { startTime: '14:00', endTime: '14:45' },
  { startTime: '14:55', endTime: '15:40' },
  { startTime: '16:00', endTime: '16:45' },
  { startTime: '16:55', endTime: '17:40' },
  { startTime: '19:00', endTime: '19:45' },
  { startTime: '19:55', endTime: '20:40' },
  { startTime: '20:50', endTime: '21:35' },
  { startTime: '21:45', endTime: '22:30' },
] as const;

const WEEKDAYS: Array<{ weekday: number; pattern: RegExp }> = [
  { weekday: 1, pattern: /(?:周|星期|礼拜)\s*一|monday|\bmon\b/i },
  { weekday: 2, pattern: /(?:周|星期|礼拜)\s*二|tuesday|\btue\b/i },
  { weekday: 3, pattern: /(?:周|星期|礼拜)\s*三|wednesday|\bwed\b/i },
  { weekday: 4, pattern: /(?:周|星期|礼拜)\s*四|thursday|\bthu\b/i },
  { weekday: 5, pattern: /(?:周|星期|礼拜)\s*五|friday|\bfri\b/i },
  { weekday: 6, pattern: /(?:周|星期|礼拜)\s*六|saturday|\bsat\b/i },
  { weekday: 7, pattern: /(?:周|星期|礼拜)\s*(?:日|天)|sunday|\bsun\b/i },
];

type Cell = {
  html: string;
  lines: string[];
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
};

type Grid = { cells: Cell[]; width: number; rowCount: number };

function normalizeDigits(value: string): string {
  return value
    .replace(/[０-９]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ':');
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", middot: '·', mdash: '—', ndash: '–',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function htmlToLines(html: string): string[] {
  const withBreaks = html
    .replace(/\s*\r?\n\s*/g, ' ')
    .replace(/<hr\b[^>]*>/gi, '\n\n')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr|section)>/gi, '\n');
  return decodeEntities(withBreaks.replace(/<[^>]*>/g, ''))
    .split('\n')
    .map((line) => normalizeDigits(line).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim());
}

function readSpan(attributes: string, name: string): number {
  const match = new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, 'i').exec(attributes);
  const value = match ? Number.parseInt(match[1], 10) : 1;
  return Number.isFinite(value) && value > 0 ? Math.min(value, 20) : 1;
}

function parseTable(tableHtml: string): Grid {
  const occupied = new Map<string, Cell>();
  const cells: Cell[] = [];
  let width = 0;
  let rowCount = 0;
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  rows.forEach((rowMatch, row) => {
    rowCount = Math.max(rowCount, row + 1);
    let col = 0;
    for (const cellMatch of rowMatch[1].matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi)) {
      while (occupied.has(`${row}:${col}`)) col += 1;
      const cell: Cell = {
        html: cellMatch[3],
        lines: htmlToLines(cellMatch[3]),
        row, col,
        rowSpan: readSpan(cellMatch[2], 'rowspan'),
        colSpan: readSpan(cellMatch[2], 'colspan'),
      };
      cells.push(cell);
      for (let rowOffset = 0; rowOffset < cell.rowSpan; rowOffset += 1) {
        for (let colOffset = 0; colOffset < cell.colSpan; colOffset += 1) {
          occupied.set(`${row + rowOffset}:${col + colOffset}`, cell);
        }
      }
      rowCount = Math.max(rowCount, row + cell.rowSpan);
      col += cell.colSpan;
      width = Math.max(width, col);
    }
    width = Math.max(width, col);
  });
  return { cells, width, rowCount };
}

function weekdayFromText(value: string): number | null {
  const text = normalizeDigits(value);
  for (const item of WEEKDAYS) if (item.pattern.test(text)) return item.weekday;
  return null;
}

function weekdayColumns(grid: Grid): { columns: Map<number, number>; headerRow: number } | null {
  const byRow = new Map<number, Cell[]>();
  for (const cell of grid.cells) {
    const list = byRow.get(cell.row) ?? [];
    list.push(cell);
    byRow.set(cell.row, list);
  }
  let best: { columns: Map<number, number>; headerRow: number } | null = null;
  for (const [row, rowCells] of byRow) {
    const columns = new Map<number, number>();
    for (const cell of rowCells) {
      const weekday = weekdayFromText(cell.lines.join(' '));
      if (weekday === null) continue;
      for (let offset = 0; offset < cell.colSpan; offset += 1) columns.set(cell.col + offset, weekday);
    }
    const labelled = rowCells.some(cell => /^(?:时间|时段|节次|节数|课节|节序)$/.test(cell.lines.join('').trim()));
    if ((columns.size >= 3 || (labelled && columns.size > 0)) && (!best || columns.size > best.columns.size)) {
      best = { columns, headerRow: row };
    }
  }
  if (best) return best;
  // No usable header: accept a full 7-column table, or the common label+7 layout.
  if (grid.width === 7) {
    return { columns: new Map([0, 1, 2, 3, 4, 5, 6].map((index) => [index, index + 1] as const)), headerRow: -1 };
  }
  if (grid.width >= 8) {
    return { columns: new Map([0, 1, 2, 3, 4, 5, 6].map((index) => [index + 1, index + 1] as const)), headerRow: -1 };
  }
  return null;
}

function extractTimeRange(value: string, periodTimes: Array<{ startTime: string; endTime: string }>) {
  const text = normalizeDigits(value);
  const clock = /(\d{1,2}):(\d{2})\s*[-–—~～至]\s*(\d{1,2}):(\d{2})/.exec(text);
  if (clock) {
    const startTime = `${clock[1].padStart(2, '0')}:${clock[2]}`;
    const endTime = `${clock[3].padStart(2, '0')}:${clock[4]}`;
    if (startTime < endTime) return { startTime, endTime };
  }
  const period = /(?:第\s*)?(\d{1,2})\s*(?:[-–—~～至]\s*(\d{1,2}))?\s*节/.exec(text);
  if (period) {
    const first = Number.parseInt(period[1], 10);
    const last = Number.parseInt(period[2] ?? period[1], 10);
    if (first >= 1 && last >= first && periodTimes[first - 1] && periodTimes[last - 1]) {
      return { startTime: periodTimes[first - 1].startTime, endTime: periodTimes[last - 1].endTime };
    }
  }
  return null;
}

function isWeekText(value: string): boolean {
  const text = normalizeDigits(value);
  if (/每周|单周|双周|odd\s*week|even\s*week/i.test(text)) return true;
  return /(?:第\s*)?\d{1,2}\s*(?:[-–—~～至]\s*\d{1,2})?\s*周/.test(text)
    || /\bweek\s*\d/i.test(text);
}

function isTeacherLine(value: string): boolean {
  return /^(?:任课教师|授课教师|教师|老师|教授|讲师|任课|授课)(?:\s*[:：]|\s+)|(?:老师|教授|讲师)$/.test(value);
}

function isLocationLine(value: string): boolean {
  return !isWeekText(value) && (
    /^(?:上课地点|授课地点|地点|教室|场地|校区)\s*[:：]|^(?:room|building)\s+/i.test(value)
    || /(?:教学楼|楼|教室|实验室|机房|体育馆|操场|校区)[\sA-Za-z\d-]*$/.test(value)
    || /教[一二三四五六七八九十\d]*\s*[-－]?\s*\d{3,4}$/.test(value)
    || /^(?:[A-Za-z]\s*[-－]?\s*\d{2,4}|\d{1,2}[-－]\d{2,4})$/.test(value)
  );
}

function parseWeeks(value: string, semesterWeeks: number, clip = true): number[] {
  // Course cells often start with "(3-4节)" and end with "/校区.../场地:5-410".
  // Strip both so only the actual week expression is parsed.
  const parts = normalizeDigits(value).split(/[\/／]/);
  const weekParts = parts.filter(isWeekText);
  const expression = (weekParts.length ? weekParts.join(',') : parts[0])
    .replace(/\(?\s*第?\s*\d{1,2}\s*[-–—~～至]\s*\d{1,2}\s*节\s*\)?/g, ' ')
    .replace(/\(?\s*第?\s*\d{1,2}\s*节\s*\)?/g, ' ');
  const text = expression.replace(/[，、]/g, ',').replace(/[~～–—至－]/g, '-');
  // A parity qualifier belongs to its week clause, e.g. 1-5周(单)、6-10周(双).
  const clauses = [...text.matchAll(/((?:\d{1,2}(?:\s*-\s*\d{1,2})?\s*,\s*)*\d{1,2}(?:\s*-\s*\d{1,2})?)\s*周(?:\s*[（(]?\s*(单双|单|双)(?:周)?\s*[）)]?)?/g)];
  const weeks = new Set<number>();
  for (const [numbers, qualifier] of clauses.length
    ? clauses.map(match => [match[1], match[2] ?? (clauses.length === 1 ? text : '')])
    : [[text, text]]) {
    const ranges = [...numbers.matchAll(/(\d{1,2})(?:\s*-\s*(\d{1,2}))?/g)].map(match => [Number(match[1]), Number(match[2] ?? match[1])]);
    const odd = !qualifier.includes('单双') && /单|odd/i.test(qualifier);
    const even = !qualifier.includes('单双') && /双|even/i.test(qualifier);
    if (!ranges.length && (odd || even)) ranges.push([1, semesterWeeks]);
    for (const [first, last] of ranges) {
      const end = Math.max(first, last);
      for (let week = Math.max(1, Math.min(first, last)); week <= end && (!clip || week <= semesterWeeks); week++) {
        if ((!odd || week % 2 === 1) && (!even || week % 2 === 0)) weeks.add(week);
      }
    }
  }
  return [...weeks].sort((a, b) => a - b);
}

function cleanName(value: string): string {
  return value
    .replace(/^[[【(（][^\]】)）]*[\]】)）]\s*/, '')
    .replace(/^(?:课程名称|课程)[:：]\s*/, '')
    .replace(/\s*[(（]\d{1,2}\s*[-~至]\s*\d{1,2}\s*周[)）]\s*$/, '')
    .trim();
}

function normalizeLocation(value: string): string | null {
  let text = value;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = text
      .replace(/^[\s:：/]+/, '')
      .replace(/^区[\s:：/]*/, '')
      .replace(/^(?:白云)?校区[\s/]*/, '')
      .replace(/^[\s:：/]+/, '')
      .replace(/^(?:上课地点|授课地点|地点|教室|场地)[:：]?\s*/, '')
      .replace(/^[\s/]+/, '')
      .trim();
    if (next === text) break;
    text = next;
  }
  return text || null;
}

function joinNameParts(parts: string[]): string {
  return parts.reduce((joined, part) => {
    if (!joined) return part;
    const noSpace = /[\u4e00-\u9fff]$/.test(joined) && /^[\u4e00-\u9fff]/.test(part);
    return joined + (noSpace ? '' : ' ') + part;
  }, '');
}

function parseEntry(lines: string[], semesterWeeks: number, warnings: string[]): ParsedCourseDraft | null {
  const cleaned = lines.map((line) => line.trim()).filter(Boolean);
  if (!cleaned.length) return null;
  const weekLines = cleaned.filter(isWeekText);
  const weekIndex = cleaned.findIndex(isWeekText);
  const nameParts = (weekIndex >= 0 ? cleaned.slice(0, weekIndex) : cleaned)
    .filter((line) => !isWeekText(line) && !isTeacherLine(line) && !isLocationLine(line))
    .filter((line) => !/^(?:必修|选修|限选|任选|公选|专业必修|专业选修)$/.test(line));
  const name = nameParts.length ? cleanName(joinNameParts(nameParts)) : '';
  if (!name) {
    warnings.push(`无法确定“${cleaned.join(' / ').slice(0, 40)}”的课程名称，已跳过`);
    return null;
  }
  const teacherLine = cleaned.find((line) => isTeacherLine(line));
  const locationLines = cleaned.filter((line) => isLocationLine(line) && !isTeacherLine(line));
  const teacher = teacherLine
    ? teacherLine.replace(/^(?:任课教师|授课教师|教师|老师|教授|讲师|任课|授课)\s*[:：]?\s*/, '').trim() || null
    : null;
  const locationText = locationLines.length ? joinNameParts(locationLines) : '';
  const location = locationText ? normalizeLocation(locationText) : null;
  const requested = [...new Set(weekLines.flatMap(line => parseWeeks(line, semesterWeeks, false)))].sort((a, b) => a - b);
  const weeks = requested.filter(week => week <= semesterWeeks);
  const allWeeks = weekLines.every(line => /每周|单双周/.test(line) && !/\d\s*周/.test(line));
  if (weekLines.length && !weeks.length && (requested.length || !allWeeks)) {
    warnings.push(`“${name}”没有可识别且位于本阶段的上课周次，已跳过`);
    return null;
  }
  if (weeks.length !== requested.length) warnings.push(`“${name}”超出本阶段的周次已忽略`);
  return {
    name, teacher, location, weekday: 0, startTime: '', endTime: '',
    weeks,
    evidence: cleaned.join(' / ').slice(0, 300),
  };
}

function splitCellEntries(lines: string[]): string[][] {
  const entries: string[][] = [];
  let current: string[] = [];
  let sawWeek = false;
  for (const line of lines) {
    const week = isWeekText(line);
    if (current.length && (!line || (sawWeek && !week && !isLocationLine(line) && !isTeacherLine(line)))) {
      entries.push(current);
      current = [];
      sawWeek = false;
    }
    if (line) current.push(line);
    if (week) sawWeek = true;
  }
  if (current.length) entries.push(current);
  return entries;
}

function entryKey(course: ParsedCourseDraft): string {
  return [course.name, course.weekday, course.startTime, course.endTime, course.teacher ?? '', course.location ?? '',
    course.weeks.join(',')].join('|');
}

function mergeCourseIdentities(courses: ParsedCourseDraft[]): ParsedCourseDraft[] {
  const byIdentity = new Map<string, ParsedCourseDraft>();
  for (const course of courses) {
    const key = [course.name, course.weekday, course.startTime, course.endTime,
      course.teacher ?? '', course.location ?? ''].join('|');
    const previous = byIdentity.get(key);
    if (!previous) {
      byIdentity.set(key, { ...course, weeks: [...course.weeks] });
      continue;
    }
    // Same course/time/location split across week ranges is one recurring course.
    previous.weeks = previous.weeks.length === 0 || course.weeks.length === 0
      ? [] : [...new Set([...previous.weeks, ...course.weeks])].sort((a, b) => a - b);
    previous.evidence = `${previous.evidence} ｜ ${course.evidence}`.slice(0, 400);
  }
  return [...byIdentity.values()];
}

export function parseCourseTableHtml(
  html: string,
  options: CourseTableParseOptions = {},
): CourseTableParseResult {
  const semesterWeeks = Math.max(1, Math.min(options.semesterWeeks ?? 30, 60));
  const periodTimes = options.periodTimes ?? [...DEFAULT_PERIOD_TIMES];
  const warnings: string[] = [];
  if (!html.trim()) return { courses: [], warnings: ['HTML 内容为空'], tableCount: 0 };
  const tables = [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  if (!tables.length) return { courses: [], warnings: ['没有找到 <table> 课程表，请确认导出的是 HTML 表格页面'], tableCount: 0 };

  const merged = new Map<string, ParsedCourseDraft>();
  for (const table of tables) {
    const grid = parseTable(table[1]);
    if (!grid.cells.length) continue;
    const header = weekdayColumns(grid);
    if (!header) {
      warnings.push('有一张表无法识别星期列，已跳过');
      continue;
    }
    const rowTimes = new Map<number, { startTime: string; endTime: string; printedClock: boolean }>();
    const periodColumns = new Set(grid.cells.filter(cell => cell.row === header.headerRow
      && /^(?:节次|节数|课节|节序)$/.test(cell.lines.join('').trim())).map(cell => cell.col));
    for (let row = 0; row < grid.rowCount; row += 1) {
      // A time label can span several rows. Course text in a neighbouring day is never a row label.
      const rowCells = grid.cells.filter(cell => !header.columns.has(cell.col)
        && cell.row <= row && cell.row + cell.rowSpan > row);
      const rowText = rowCells.map(cell => {
        const label = cell.lines.join(' ').trim();
        return periodColumns.has(cell.col) && /^\d{1,2}(?:\s*[-–—~～至]\s*\d{1,2})?$/.test(label) ? `第${label}节` : label;
      }).join(' ');
      const range = extractTimeRange(rowText, periodTimes);
      if (range) rowTimes.set(row, { ...range, printedClock: /\d{1,2}:\d{2}/.test(rowText) });
    }
    for (const cell of grid.cells) {
      if (cell.row <= header.headerRow) continue;
      const text = cell.lines.join(' ').trim();
      if (!text) continue;
      const weekday = header.columns.get(cell.col);
      if (!weekday) continue;
      if (Array.from({ length: cell.colSpan }, (_, i) => header.columns.get(cell.col + i)).some(day => day !== weekday)) {
        warnings.push(`“${text.slice(0, 40)}”横跨多个星期列，无法确定上课日，已跳过`);
        continue;
      }
      for (const entryLines of splitCellEntries(cell.lines)) {
        const entry = parseEntry(entryLines, semesterWeeks, warnings);
        if (!entry) continue;
        const entryText = entryLines.join(' ');
        const rowStart = rowTimes.get(cell.row);
        const inline = rowStart?.printedClock && !/\d{1,2}:\d{2}/.test(entryText) ? null : extractTimeRange(entryText, periodTimes);
        const startTime = inline?.startTime ?? rowStart?.startTime;
        const endTime = inline?.endTime ?? rowTimes.get(cell.row + cell.rowSpan - 1)?.endTime;
        if (!startTime || !endTime || startTime >= endTime) {
          warnings.push(`无法确定“${entry.name}”的时间，已跳过`);
          continue;
        }
        const course: ParsedCourseDraft = {
          ...entry, weekday, startTime, endTime,
          weeks: entry.weeks.length ? entry.weeks : [],
        };
        const key = entryKey(course);
        const previous = merged.get(key);
        if (previous) previous.evidence = `${previous.evidence} ｜ ${course.evidence}`.slice(0, 400);
        else merged.set(key, course);
      }
    }
  }
  const courses = mergeCourseIdentities([...merged.values()]).sort((a, b) => a.weekday - b.weekday
    || a.startTime.localeCompare(b.startTime) || a.name.localeCompare(b.name));
  if (!courses.length) warnings.push('没有解析出可导入的课程，请检查表头、时间行和单元格内容');
  return { courses, warnings: [...new Set(warnings)], tableCount: tables.length };
}

/** Public helper for the manual Course form; accepts "每周", "1-16", "1-8,10-16", "单周", "双周". */
export function parseWeekExpression(value: string, semesterWeeks: number): number[] {
  return parseWeeks(value, semesterWeeks);
}

/** Largest explicit week number in an expression; null for parity-only text. */
export function maxWeekExpression(value: string): number | null {
  const numbers = [...normalizeDigits(value).matchAll(/\d{1,2}/g)].map((match) => Number.parseInt(match[0], 10));
  return numbers.length ? Math.max(...numbers) : null;
}

/** Public helper for PDF layout reconstruction. */
export function weekdayNumberFromLabel(value: string): number | null {
  return weekdayFromText(value);
}

export function weekdayLabel(weekday: number): string {
  return ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][weekday - 1] ?? `周${weekday}`;
}

export function formatWeeks(weeks: number[]): string {
  if (!weeks.length) return '每周';
  const ranges: string[] = [];
  let start = weeks[0];
  let previous = weeks[0];
  for (const week of weeks.slice(1)) {
    if (week === previous + 1) { previous = week; continue; }
    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = week;
    previous = week;
  }
  ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
  return `第 ${ranges.join('、')} 周`;
}
