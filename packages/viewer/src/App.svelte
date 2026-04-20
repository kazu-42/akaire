<script lang="ts">
  import { onMount } from "svelte";
  import PDFViewer from "./components/PDFViewer.svelte";
  import ThreadPanel from "./components/ThreadPanel.svelte";
  import CommentDialog from "./components/CommentDialog.svelte";
  import { api } from "./lib/api";
  import { versionId, annotations, errorMessage } from "./lib/stores";
  import type { Annotation, AnnotationKind, NewAnnotation, PDFVersion } from "./lib/types";

  interface SelectionInfo {
    page: number;
    quote: string;
    pageOffsetStart: number;
    pageOffsetEnd: number;
    bbox: { x1: number; y1: number; x2: number; y2: number };
    anchorRect: DOMRect;
  }

  let version: PDFVersion | null = $state(null);
  let pdfUrl = $state("");
  let currentVersionId = $state("");
  let annotationList: Annotation[] = $state([]);
  let loadingVersion = $state(true);
  let dialogSelection: SelectionInfo | null = $state(null);
  let errorText: string | null = $state(null);

  versionId.subscribe((v) => (currentVersionId = v));
  annotations.subscribe((v) => (annotationList = v));
  errorMessage.subscribe((v) => (errorText = v));

  onMount(async () => {
    // URL hash から versionId を取得: #/view/<versionId>
    const m = location.hash.match(/^#\/view\/([^/?#]+)/);
    const id = m?.[1] ?? "";
    if (!id) {
      errorMessage.set(
        "URL に version ID が指定されていません。#/view/<version-id> を付けてください。"
      );
      loadingVersion = false;
      return;
    }
    versionId.set(id);
    try {
      version = await api.getVersion(id);
      pdfUrl = api.pdfUrl(id);
      const list = await api.listAnnotations(id);
      annotations.set(list);
    } catch (err) {
      errorMessage.set(err instanceof Error ? err.message : String(err));
    } finally {
      loadingVersion = false;
    }
  });

  function handleSelection(info: SelectionInfo) {
    dialogSelection = info;
  }

  async function submitComment(payload: { comment: string; kind: AnnotationKind }) {
    if (!dialogSelection || !currentVersionId) return;
    const body: NewAnnotation = {
      version_id: currentVersionId,
      page: dialogSelection.page,
      quote: dialogSelection.quote,
      page_offset_start: dialogSelection.pageOffsetStart,
      page_offset_end: dialogSelection.pageOffsetEnd,
      bbox_x1: dialogSelection.bbox.x1,
      bbox_y1: dialogSelection.bbox.y1,
      bbox_x2: dialogSelection.bbox.x2,
      bbox_y2: dialogSelection.bbox.y2,
      comment: payload.comment,
      kind: payload.kind,
    };
    try {
      const created = await api.createAnnotation(body);
      annotations.update((list) => [...list, created].sort(byPageAndTime));
    } catch (err) {
      errorMessage.set(err instanceof Error ? err.message : String(err));
    } finally {
      dialogSelection = null;
      window.getSelection()?.removeAllRanges();
    }
  }

  function byPageAndTime(a: Annotation, b: Annotation): number {
    if (a.page !== b.page) return a.page - b.page;
    return a.created_at - b.created_at;
  }

  function cancelDialog() {
    dialogSelection = null;
    window.getSelection()?.removeAllRanges();
  }
</script>

<div class="app">
  <header class="topbar">
    <h1>akaire</h1>
    <span class="sep">|</span>
    {#if version}
      <span>{version.label ?? version.id}</span>
      <span class="sep">·</span>
      <span>{version.page_count} pages</span>
    {:else if !loadingVersion}
      <span class="error">version 未取得</span>
    {/if}
  </header>

  {#if errorText}
    <div class="error">{errorText}</div>
  {/if}

  <main class="viewer">
    {#if loadingVersion}
      <div class="loading">読み込み中…</div>
    {:else if pdfUrl}
      <PDFViewer url={pdfUrl} annotations={annotationList} onSelectionCreated={handleSelection} />
    {/if}
  </main>

  <aside class="sidebar">
    <ThreadPanel annotations={annotationList} />
  </aside>
</div>

{#if dialogSelection}
  <CommentDialog
    quote={dialogSelection.quote}
    onSubmit={submitComment}
    onCancel={cancelDialog}
  />
{/if}
