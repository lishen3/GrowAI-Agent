import { weekdayLabel, weekdayNumberFromLabel } from './parseCourseTableHtml';

export type PdfTextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfPageText = {
  width: number;
  height: number;
  items: PdfTextItem[];
};

export type PdfTimetableLayout = {
  html: string;
  warnings: string[];
  headerFound: boolean;
};

type Line = { y: number; items: PdfTextItem[] };
type ColumnCenter = { weekday: number; center: number };

const Y_TOLERANCE = 3.5;

function clusterLines(items: PdfTextItem[]): Line[] {
  const sorted = items
    .filter((item) => item.str.trim())
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const item of sorted) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= Y_TOLERANCE);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => b.y - a.y);
}

function lineText(line: Line): string {
  return joinItems(line.items.map((item) => item.str));
}

function joinItems(values: string[]): string {
  return values.reduce((joined, value) => {
    const part = value.trim();
    if (!part) return joined;
    if (!joined) return part;
    const noSpace = /[\u4e00-\u9fff]$/.test(joined) && /^[\u4e00-\u9fff]/.test(part);
    return joined + (noSpace ? '' : ' ') + part;
  }, '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function timeLabel(text: string): string | null {
  const clock = /(\d{1,2}:\d{2})\s*[-–—~～至]\s*(\d{1,2}:\d{2})/.exec(text);
  if (clock) return `${clock[1]}-${clock[2]}`;
  const period = /(?:第\s*)?(\d{1,2})\s*(?:[-–—~～至]\s*(\d{1,2}))?\s*节/.exec(text);
  if (period) return `第${period[1]}${period[2] ? `-${period[2]}` : ''}节`;
  return null;
}

function isWeekLine(text: string): boolean {
  return /\d{1,2}\s*周|每周|单周|双周|odd\s*week|even\s*week/i.test(text);
}

function isLocationLine(text: string): boolean {
  return /场地[:：]|校区|教室[:：]|教学楼|教[一二三四五六七八九十\d]*\s*[-－]?\s*\d{3,4}|(?:室|楼|馆|场)[\dA-Za-z-]*$/.test(text)
    || /^[房室楼区（(）)]|(?:教室|机房)[）)]$/.test(text);
}

function columnCenters(header: Line): Map<number, number> {
  const centers = new Map<number, number>();
  for (let i = 0; i < header.items.length; i++) {
    const first = header.items[i];
    let label = first.str.trim();
    while (/^(?:星|星期|礼|礼拜|周)$/.test(label) && i + 1 < header.items.length) {
      const next = header.items[i + 1];
      if (next.x - (header.items[i].x + header.items[i].width) > first.height ||
        !/^(?:期|拜|[一二三四五六日天]|期[一二三四五六日天]|拜[一二三四五六日天])$/.test(next.str.trim())) break;
      label += next.str.trim();
      i++;
    }
    const weekday = weekdayNumberFromLabel(label);
    if (weekday !== null && !centers.has(weekday)) centers.set(weekday, (first.x + header.items[i].x + header.items[i].width) / 2);
  }
  return centers;
}

function bounds(centers: ColumnCenter[]) {
  const result = new Map<number, { left: number; right: number }>();
  for (let index = 0; index < centers.length; index += 1) {
    const current = centers[index];
    const previous = centers[index - 1];
    const next = centers[index + 1];
    result.set(current.weekday, {
      left: previous ? (previous.center + current.center) / 2 : current.center - (next ? (next.center - current.center) / 2 : 70),
      right: next ? (current.center + next.center) / 2 : current.center + (previous ? (current.center - previous.center) / 2 : 70),
    });
  }
  return result;
}

function timeRows(lines: Line[], firstLeft: number): Array<{ y: number; label: string }> {
  const rows: Array<{ y: number; label: string }> = [];
  for (const line of lines) {
    const left = line.items.filter((item) => item.x + item.width / 2 < firstLeft);
    if (!left.length) continue;
    const text = joinItems(left.map((item) => item.str));
    const standard = timeLabel(text);
    const y = Math.min(...left.map((item) => item.y));
    if (standard) rows.push({ y, label: standard });
    else if (/^\d{1,2}$/.test(text)) rows.push({ y, label: `第${text}节` });
  }
  return rows.sort((a, b) => a.y - b.y);
}

function nearestTime(rows: Array<{ y: number; label: string }>, y: number): string | null {
  if (!rows.length) return null;
  let best = rows[0];
  let distance = Math.abs(rows[0].y - y);
  for (const row of rows.slice(1)) {
    const next = Math.abs(row.y - y);
    if (next < distance) { best = row; distance = next; }
  }
  return best.label;
}

function periodRange(text: string): string | null {
  const range = /(?:第\s*)?(\d{1,2})\s*[-–—~～至]\s*(\d{1,2})\s*节/.exec(text);
  if (range) return `第${range[1]}-${range[2]}节`;
  const single = /(?:第\s*)?(\d{1,2})\s*节/.exec(text);
  return single ? `第${single[1]}节` : null;
}

type Entry = { weekday: number; lines: string[]; time: string };

function columnEntries(lines: Line[], ordered: ColumnCenter[], ranges: Map<number, { left: number; right: number }>,
  times: Array<{ y: number; label: string }>, warn: (message: string) => void): Entry[] {
  const entries: Entry[] = [];
  for (const column of ordered) {
    const range = ranges.get(column.weekday)!;
    const columnLines = lines.filter((line) => line.items.some((item) => {
      const center = item.x + item.width / 2;
      return center >= range.left && center < range.right;
    })).sort((a, b) => a.y - b.y);
    let current: Array<{ text: string; slot: string | null }> = [];
    let currentTime: string | null = null;
    let previousY = 0;
    let last: Entry | null = null;
    function flush(time: string | null): Entry | null {
      if (current.length && time) {
        const entry = { weekday: column.weekday, lines: current.map(line => line.text), time };
        entries.push(entry);
        current = [];
        return entry;
      }
      warn(`${weekdayLabel(column.weekday)}有课程缺少可识别的名称或节次，已跳过，请核对原表。`);
      current = [];
      return null;
    }
    function flushWithoutWeeks() {
      const lines = current;
      current = [];
      for (const line of lines) {
        if (current.length && current[0].slot !== line.slot) flush(current[0].slot);
        current.push(line);
      }
      if (current.length) flush(current[0].slot);
    }
    for (const line of columnLines) {
      const items = line.items.filter((item) => {
        const center = item.x + item.width / 2;
        return center >= range.left && center < range.right;
      });
      if (!items.length) continue;
      const text = joinItems(items.map((item) => item.str));
      if (!text) continue;
      if (text === '节次' || text === '时间段' || /打印时间|学号|课表/.test(text)) continue;
      const y = items[0].y;
      const slot = nearestTime(times, y);
      // In a merged cell the title can wrap across numbered row labels. Only a
      // gap greater than ordinary line spacing separates distant unmarked cells.
      const separate = y - previousY > Math.max(...items.map(item => item.height)) * 2;
      if (separate && slot !== currentTime) {
        flushWithoutWeeks();
        last = null;
      }
      if (isWeekLine(text)) {
        const metadata = text.search(/[（(]?\s*(?:第\s*)?\d{1,2}\s*(?:(?:[-–—~～至,，、]\s*\d{1,2}\s*)+)?[节周]|每周|单周|双周|odd\s*week|even\s*week/i);
        const title = metadata > 0 ? text.slice(0, metadata).trim() : '';
        if (title) current.push({ text: title, slot });
        const time = periodRange(text) ?? current[0]?.slot ?? slot;
        if (current.length) current.push({ text: text.slice(Math.max(metadata, 0)).trim(), slot });
        last = flush(time);
      } else if (last && (isLocationLine(text) || /[（(]$/.test(last.lines[last.lines.length - 1] ?? ''))) {
        // Keep a wrapped location explicitly labelled for the shared HTML cell parser.
        const tail = last.lines.length - 1;
        if (last.lines[tail].startsWith('地点：')) last.lines[tail] += text;
        else last.lines.push(`地点：${text}`);
      } else {
        if (!current.length) currentTime = slot;
        current.push({ text, slot });
        last = null;
      }
      previousY = y;
    }
    flushWithoutWeeks();
  }
  return entries;
}

function pageHtml(page: PdfPageText, pageIndex: number, inherited: ColumnCenter[], warnings: string[]): {
  html: string | null; warning: string | null; centers?: ColumnCenter[];
} {
  const lines = clusterLines(page.items);
  if (!lines.length) return { html: null, warning: `PDF 第 ${pageIndex + 1} 页没有可提取文字` };
  const header = lines.find((line) => columnCenters(line).size >= 3);
  const centers = header ? columnCenters(header) : new Map<number, number>();
  let ordered: ColumnCenter[] = [...centers.entries()]
    .map(([weekday, center]) => ({ weekday, center })).sort((a, b) => a.center - b.center);
  if (ordered.length < 3) {
    if (inherited.length < 3) return { html: null, warning: `PDF 第 ${pageIndex + 1} 页没有识别到星期表头` };
    ordered = inherited;
  }
  const ranges = bounds(ordered);
  const firstLeft = ordered[0].center - (ordered[1].center - ordered[0].center) / 2;
  const body = lines.filter(line => !header || line.y > header.y + Y_TOLERANCE);
  const footer = body.find(line => /^(?:其他课程|未排时间课程|未排课课程)\s*[:：]/.test(lineText(line)));
  if (footer) {
    const details = lineText(footer).replace(/^[^:：]+[:：]\s*/, '').replace(/[;；]\s*$/, '');
    warnings.push(`PDF 第 ${pageIndex + 1} 页另列课程未提供可定位的星期和时段，请核对并手动安排：${details}`);
  }
  const grid = body.filter(line => !footer || line.y < footer.y);
  const times = timeRows(grid, firstLeft);
  const entries = columnEntries(grid, ordered, ranges, times, message => warnings.push(`PDF 第 ${pageIndex + 1} 页${message}`));
  if (!entries.length) return { html: null, warning: `PDF 第 ${pageIndex + 1} 页没有识别到课程块` };

  const rows = entries.map((entry) => {
    const cells = ordered.map((column) => column.weekday === entry.weekday
      ? `<td>${entry.lines.map(escapeHtml).join('<br>')}</td>` : '<td></td>').join('');
    return `<tr><td>${escapeHtml(entry.time)}</td>${cells}</tr>`;
  });
  const headerHtml = `<tr><th>时间</th>${ordered.map((entry) => `<th>${weekdayLabel(entry.weekday)}</th>`).join('')}</tr>`;
  return { html: `<table>${headerHtml}${rows.join('')}</table>`, warning: null, centers: ordered };
}

/**
 * Reconstructs a table-shaped HTML document from PDF text coordinates, then
 * reuses the proven HTML course-cell parser. Scanned/image PDFs have no text
 * items and must be rejected explicitly by the caller.
 */
export function buildTimetableHtmlFromPages(pages: PdfPageText[]): PdfTimetableLayout {
  const warnings: string[] = [];
  let headerFound = false;
  let inherited: ColumnCenter[] = [];
  const tables: string[] = [];
  pages.forEach((page, index) => {
    const result = pageHtml(page, index, inherited, warnings);
    if (result.html) {
      tables.push(result.html);
      headerFound = true;
      if (result.centers) inherited = result.centers;
    } else if (result.warning) warnings.push(result.warning);
  });
  if (!tables.length) {
    warnings.push('PDF 没有可用的课程表文字。扫描件/图片型 PDF 需要 OCR，当前版本不支持。');
  }
  return { html: tables.join('\n'), warnings, headerFound };
}
