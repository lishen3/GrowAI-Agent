import type { PdfPageText } from '@/domain/courses/pdfTimetableLayout';

/** Native builds must not import pdfjs-dist (DOM/worker based). */
export async function extractPdfPages(_file: File): Promise<PdfPageText[]> {
  throw new Error('PDF 导入目前只支持 Web/PWA；手机端请使用 HTML 或手动录入');
}
