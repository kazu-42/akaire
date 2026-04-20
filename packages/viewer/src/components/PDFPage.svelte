<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { pdfjsLib, type PDFPage as Page } from "../lib/pdf";
  import type { Annotation } from "../lib/types";
  import { activeAnnotationId } from "../lib/stores";

  let {
    page,
    pageNumber,
    scale = 1.5,
    annotations = [],
    onSelectionCreated,
  }: {
    page: Page;
    pageNumber: number;
    scale?: number;
    annotations?: Annotation[];
    onSelectionCreated: (info: SelectionInfo) => void;
  } = $props();

  export interface SelectionInfo {
    page: number;
    quote: string;
    pageOffsetStart: number;
    pageOffsetEnd: number;
    bbox: { x1: number; y1: number; x2: number; y2: number };
    anchorRect: DOMRect;
  }

  let containerEl: HTMLDivElement | undefined = $state();
  let canvasEl: HTMLCanvasElement | undefined = $state();
  let textLayerEl: HTMLDivElement | undefined = $state();
  let annotationLayerEl: HTMLDivElement | undefined = $state();
  let currentActiveId: string | null = $state(null);

  const unsub = activeAnnotationId.subscribe((v) => (currentActiveId = v));

  onDestroy(() => unsub());

  // ページ内テキストを線形化した配列 (文字単位で offset を数えるため)
  let textItemsFlat: Array<{ str: string; startOffset: number; endOffset: number; span: HTMLSpanElement }> = [];
  let pageText = "";

  onMount(async () => {
    if (!canvasEl || !textLayerEl || !containerEl) return;
    const viewport = page.getViewport({ scale });
    containerEl.style.width = `${viewport.width}px`;
    containerEl.style.height = `${viewport.height}px`;
    canvasEl.width = viewport.width;
    canvasEl.height = viewport.height;

    // 描画
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;
    await page.render({ canvasContext: ctx, viewport }).promise;

    // テキストレイヤ
    const textContent = await page.getTextContent();
    textLayerEl.style.width = `${viewport.width}px`;
    textLayerEl.style.height = `${viewport.height}px`;

    let offset = 0;
    const parts: string[] = [];
    for (const item of textContent.items) {
      if (!("str" in item)) continue;
      const span = document.createElement("span");
      span.textContent = item.str;
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontSize = Math.hypot(tx[0], tx[1]);
      const left = tx[4];
      const top = tx[5] - fontSize;
      span.style.left = `${left}px`;
      span.style.top = `${top}px`;
      span.style.fontSize = `${fontSize}px`;
      span.style.fontFamily = item.fontName ?? "sans-serif";
      // 横幅調整は概算; item.width (PDF 座標単位) * scale
      if (item.width) {
        const renderedWidth = item.width * scale;
        const naturalWidth = span.textContent?.length
          ? fontSize * 0.5 * span.textContent.length
          : 0;
        if (naturalWidth > 0) {
          span.style.transform = `scaleX(${renderedWidth / naturalWidth})`;
        }
      }
      textLayerEl.appendChild(span);
      textItemsFlat.push({
        str: item.str,
        startOffset: offset,
        endOffset: offset + item.str.length,
        span,
      });
      parts.push(item.str);
      offset += item.str.length;
      // 改行 hasEOL の場合、オフセット進める
      if ("hasEOL" in item && item.hasEOL) {
        parts.push("\n");
        offset += 1;
      }
    }
    pageText = parts.join("");
  });

  // テキスト選択を検出
  function handleMouseUp() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const quote = sel.toString();
    if (!quote.trim()) return;

    // 範囲の両端コンテナが textLayerEl 配下か確認
    if (!textLayerEl || !textLayerEl.contains(range.startContainer)) return;

    // page offset を特定: startContainer/endContainer の親 span をマッチ
    const startSpan = findParentSpan(range.startContainer);
    const endSpan = findParentSpan(range.endContainer);
    if (!startSpan || !endSpan) return;

    const startItem = textItemsFlat.find((t) => t.span === startSpan);
    const endItem = textItemsFlat.find((t) => t.span === endSpan);
    if (!startItem || !endItem) return;

    const pageOffsetStart = startItem.startOffset + range.startOffset;
    const pageOffsetEnd = endItem.startOffset + range.endOffset;

    // bbox: 選択の境界矩形
    const rect = range.getBoundingClientRect();
    const containerRect = containerEl!.getBoundingClientRect();
    const bbox = {
      x1: (rect.left - containerRect.left) / scale,
      y1: (rect.top - containerRect.top) / scale,
      x2: (rect.right - containerRect.left) / scale,
      y2: (rect.bottom - containerRect.top) / scale,
    };

    onSelectionCreated({
      page: pageNumber,
      quote,
      pageOffsetStart,
      pageOffsetEnd,
      bbox,
      anchorRect: rect,
    });
  }

  function findParentSpan(node: Node): HTMLSpanElement | null {
    let n: Node | null = node;
    while (n) {
      if (n instanceof HTMLSpanElement && n.parentElement === textLayerEl) return n;
      n = n.parentNode;
    }
    return null;
  }

  function onAnnotationClick(id: string) {
    activeAnnotationId.set(id);
  }
</script>

<div class="pdf-page" bind:this={containerEl} data-page={pageNumber}>
  <canvas bind:this={canvasEl}></canvas>
  <div
    class="text-layer"
    bind:this={textLayerEl}
    onmouseup={handleMouseUp}
  ></div>
  <div class="annotation-layer" bind:this={annotationLayerEl}>
    {#each annotations as a (a.id)}
      {#if a.bbox_x1 !== null && a.bbox_y1 !== null && a.bbox_x2 !== null && a.bbox_y2 !== null}
        <div
          class="annotation-highlight"
          class:active={currentActiveId === a.id}
          style="left:{a.bbox_x1 * scale}px;
                 top:{a.bbox_y1 * scale}px;
                 width:{(a.bbox_x2 - a.bbox_x1) * scale}px;
                 height:{(a.bbox_y2 - a.bbox_y1) * scale}px;"
          title={a.comment}
          onclick={() => onAnnotationClick(a.id)}
          onkeydown={(e) => { if (e.key === "Enter") onAnnotationClick(a.id); }}
          role="button"
          tabindex="0"
        ></div>
      {/if}
    {/each}
  </div>
</div>
