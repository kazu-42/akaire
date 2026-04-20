<script lang="ts">
  import type { Annotation } from "../lib/types";
  import { activeAnnotationId } from "../lib/stores";

  let { annotations = [] }: { annotations: Annotation[] } = $props();

  let currentActive: string | null = $state(null);
  activeAnnotationId.subscribe((v) => (currentActive = v));

  function onClick(id: string) {
    activeAnnotationId.set(id);
    // 該当ハイライトまでスクロール
    const el = document.querySelector(`.pdf-page[data-page="${byId(id)?.page}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function byId(id: string): Annotation | undefined {
    return annotations.find((a) => a.id === id);
  }

  function kindLabel(kind: string): string {
    switch (kind) {
      case "typo": return "誤字";
      case "suggestion": return "提案";
      case "question": return "質問";
      case "praise": return "評価";
      default: return "コメント";
    }
  }

  function authorLabel(a: Annotation): string {
    return a.author_github ? `@${a.author_github}` : a.author_email.split("@")[0];
  }

  function timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return "now";
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `${day}d ago`;
  }

  // ページ順 → 作成時刻でソート済み (API 側で済)
</script>

<div class="threads">
  <h2>指摘 ({annotations.length})</h2>
  {#if annotations.length === 0}
    <div class="empty-state">まだ指摘はありません。本文をドラッグ選択して追加できます。</div>
  {:else}
    {#each annotations as a (a.id)}
      <div
        class="thread"
        class:active={currentActive === a.id}
        onclick={() => onClick(a.id)}
        onkeydown={(e) => { if (e.key === "Enter") onClick(a.id); }}
        role="button"
        tabindex="0"
      >
        <div class="head">
          <span class="kind-badge {a.kind}">{kindLabel(a.kind)}</span>
          <span>p.{a.page}</span>
          <span>{authorLabel(a)}</span>
          <span>{timeAgo(a.created_at)}</span>
          {#if a.github_issue_number !== null}
            <span>#{a.github_issue_number}</span>
          {/if}
        </div>
        <div class="quote">{a.quote}</div>
        <div class="comment">{a.comment}</div>
      </div>
    {/each}
  {/if}
</div>
