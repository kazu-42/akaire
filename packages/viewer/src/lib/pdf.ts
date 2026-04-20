// PDF.js ラッパ
//
// legacy build を使う理由: Vite + モジュール解決の落とし穴を避けるため。
// ESM 版は worker 設定が面倒だが、legacy は URL を渡すだけで動く。

import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type PDFDocument = Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>;
export type PDFPage = Awaited<ReturnType<PDFDocument["getPage"]>>;

export async function loadPDF(url: string): Promise<PDFDocument> {
  const task = pdfjsLib.getDocument({
    url,
    withCredentials: true,
  });
  return await task.promise;
}

export { pdfjsLib };
