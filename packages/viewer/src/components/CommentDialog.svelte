<script lang="ts">
  import type { AnnotationKind } from "../lib/types";

  let {
    quote,
    onSubmit,
    onCancel,
  }: {
    quote: string;
    onSubmit: (payload: { comment: string; kind: AnnotationKind }) => void;
    onCancel: () => void;
  } = $props();

  let comment = $state("");
  let kind: AnnotationKind = $state("comment");

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (!comment.trim()) return;
    onSubmit({ comment: comment.trim(), kind });
  }

  function handleKeyDown(e: KeyboardEvent) {
    // Cmd+Enter / Ctrl+Enter で送信
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      handleSubmit(e);
    }
    if (e.key === "Escape") onCancel();
  }
</script>

<div class="dialog-backdrop" onclick={onCancel} role="presentation">
  <form
    class="dialog"
    onsubmit={handleSubmit}
    onclick={(e) => e.stopPropagation()}
    onkeydown={handleKeyDown}
    role="dialog"
    aria-label="コメント投稿"
  >
    <h2>コメントを追加</h2>
    <div class="quote-preview">{quote}</div>

    <label>
      種類
      <select bind:value={kind}>
        <option value="comment">コメント</option>
        <option value="typo">誤字・脱字</option>
        <option value="suggestion">提案</option>
        <option value="question">質問</option>
        <option value="praise">評価</option>
      </select>
    </label>

    <label>
      本文
      <textarea
        bind:value={comment}
        placeholder="この範囲について一言…"
        autofocus
      ></textarea>
    </label>

    <div class="actions">
      <button type="button" onclick={onCancel}>キャンセル</button>
      <button type="submit" class="primary" disabled={!comment.trim()}>送信 (⌘Enter)</button>
    </div>
  </form>
</div>
