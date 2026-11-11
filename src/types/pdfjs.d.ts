declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export const GlobalWorkerOptions: { workerSrc: string };
  export const Util: {
    transform(transform: number[], matrix: number[]): number[];
  };
  export function getDocument(options: Record<string, unknown>): {
    destroy(): Promise<void>;
    promise: Promise<{
      numPages: number;
      getPage(pageNumber: number): Promise<{
        getViewport(options: { scale: number }): { width: number; height: number; transform: number[] };
        getTextContent(): Promise<{
          items: Array<{ str?: string; transform?: number[]; width?: number; height?: number }>;
        }>;
        cleanup(): void;
      }>;
    }>;
  };
}
