import type { PdfPageText } from '@/domain/courses/pdfTimetableLayout';

/**
 * Non-platform fallback. Metro uses pdfTextExtractor.web.ts for Web/PWA and
 * pdfTextExtractor.native.ts for iOS/Android, so pdfjs-dist is not bundled into
 * the Hermes native bundle.
 */
export async function extractPdfPages(_file: File): Promise<PdfPageText[]> {
  throw new Error('PDF 导入目前只支持 Web/PWA；手机端请使用 HTML 或手动录入');
}
