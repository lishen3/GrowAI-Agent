import type { CourseTableParseOptions, CourseTableParseResult } from '@/domain/courses/parseCourseTableHtml';
import { parseCourseTableHtml } from '@/domain/courses/parseCourseTableHtml';
import { buildTimetableHtmlFromPages } from '@/domain/courses/pdfTimetableLayout';
import { extractPdfPages } from '@/infrastructure/files/pdfTextExtractor';

export type PdfCourseTableParseResult = CourseTableParseResult & { pages: number };

/**
 * Extracts positioned text from a text-based PDF, reconstructs a table-shaped
 * HTML document, then reuses the same course-cell parser as HTML import.
 * Scanned/image PDFs return warnings instead of fabricated courses.
 */
export async function parsePdfCourseTable(file: File, options: CourseTableParseOptions = {}): Promise<PdfCourseTableParseResult> {
  const pages = await extractPdfPages(file);
  const layout = buildTimetableHtmlFromPages(pages);
  const parsed = parseCourseTableHtml(layout.html, options);
  return {
    ...parsed,
    tableCount: parsed.tableCount,
    warnings: [...new Set([...layout.warnings, ...parsed.warnings])],
    pages: pages.length,
  };
}
