<script lang="ts">
  import { onMount } from "svelte";
  import { loadPDF, type PDFDocument, type PDFPage as Page } from "../lib/pdf";
  import PDFPage from "./PDFPage.svelte";
  import type { Annotation } from "../lib/types";

  let {
    url,
    annotations = [],
    onSelectionCreated,
  }: {
    url: string;
    annotations?: Annotation[];
    onSelectionCreated: (info: SelectionInfo) => void;
  } = $props();

  type SelectionInfo = Parameters<typeof onSelectionCreated>[0];

  let doc: PDFDocument | null = $state(null);
  let pages: Page[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);

  onMount(async () => {
    try {
      doc = await loadPDF(url);
      const ps: Page[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        ps.push(await doc.getPage(i));
      }
      pages = ps;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  function pageAnnotations(n: number): Annotation[] {
    return annotations.filter((a) => a.page === n);
  }
</script>

<div class="viewer">
  {#if loading}
    <div class="loading">PDF を読み込み中…</div>
  {:else if error}
    <div class="error">PDF の読み込みに失敗しました: {error}</div>
  {:else}
    {#each pages as page, i (i)}
      <PDFPage
        {page}
        pageNumber={i + 1}
        annotations={pageAnnotations(i + 1)}
        {onSelectionCreated}
      />
    {/each}
  {/if}
</div>
