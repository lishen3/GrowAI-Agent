import type { PdfPageText } from '@/domain/courses/pdfTimetableLayout';

/** PDF.js is loaded only when the user selects a PDF in a browser/PWA. */
export async function extractPdfPages(file: File): Promise<PdfPageText[]> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('PDF 导入目前只支持 Web/PWA；手机端请使用 HTML 或手动录入');
  }
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Resolve against the document URL so a sub-path deployment keeps working.
  const base = document.baseURI;
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', base).toString();
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({
    data,
    cMapUrl: new URL('cmaps/', base).toString(),
    cMapPacked: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  });
  const pages: PdfPageText[] = [];
  try {
    const documentProxy = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
      const page = await documentProxy.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items
        .filter((item) => typeof item.str === 'string' && Array.isArray(item.transform) && item.transform.length >= 6)
        .map((item) => {
          // getTextContent uses PDF user space; apply the page viewport so a
          // rotated timetable (common in landscape exports) becomes x=columns,
          // y=rows instead of everything sharing one x coordinate.
          const transform = pdfjs.Util.transform(viewport.transform, item.transform!);
          return {
            str: item.str!.trim(),
            x: transform[4],
            y: transform[5],
            width: typeof item.width === 'number' ? item.width : 0,
            height: typeof item.height === 'number' ? item.height : 0,
          };
        })
        .filter((item) => item.str.length > 0);
      pages.push({ width: viewport.width, height: viewport.height, items });
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
  return pages;
}
