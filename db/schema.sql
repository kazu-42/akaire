-- akaire D1 schema
-- See docs/adr/0001-data-model.md (TBD) for design rationale.

-- -----------------------------------------------------------------------------
-- PDF バージョン: ビルドの成果物と各種メタデータ
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pdf_versions (
  id TEXT PRIMARY KEY,              -- 'v2026-04-20-142p-5fcb0fd' 形式
  r2_key TEXT NOT NULL,             -- R2 bucket 内の key
  git_commit TEXT,                  -- 元ソースの git commit hash
  built_at INTEGER NOT NULL,        -- UNIX ms
  page_count INTEGER NOT NULL,
  label TEXT,                       -- 'Phase 1 完成 (v0.5)' 等の人間向け表記
  metadata_json TEXT                -- book-metadata.json をそのまま格納 (章節ラベル)
);

-- -----------------------------------------------------------------------------
-- アノテーション: 範囲ハイライト + コメント
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,              -- UUID v4
  version_id TEXT NOT NULL REFERENCES pdf_versions(id),
  author_email TEXT NOT NULL,       -- Access JWT 由来
  author_github TEXT,               -- GitHub handle (取得できれば)

  page INTEGER NOT NULL,

  -- アンカー 3 層
  quote TEXT NOT NULL,              -- 選択されたテキストそのもの
  page_offset_start INTEGER,        -- ページ内文字オフセット
  page_offset_end INTEGER,

  bbox_x1 REAL,                     -- PDF 座標系 bbox (描画用)
  bbox_y1 REAL,
  bbox_x2 REAL,
  bbox_y2 REAL,

  section_label TEXT,               -- '\label{ch:terminal-echo}' 等
                                    -- (metadata_json とのマッチ用 fallback anchor)

  comment TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'comment'
       CHECK (kind IN ('comment', 'typo', 'suggestion', 'question', 'praise')),
  status TEXT NOT NULL DEFAULT 'open'
       CHECK (status IN ('open', 'resolved', 'wontfix', 'duplicate')),

  github_issue_number INTEGER,      -- 同期済みなら Issue 番号

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_annotations_version_page
  ON annotations(version_id, page);
CREATE INDEX IF NOT EXISTS idx_annotations_section
  ON annotations(section_label);
CREATE INDEX IF NOT EXISTS idx_annotations_status
  ON annotations(status);
CREATE INDEX IF NOT EXISTS idx_annotations_author
  ON annotations(author_email);

-- -----------------------------------------------------------------------------
-- 返信: アノテーションへのスレッド
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS annotation_replies (
  id TEXT PRIMARY KEY,
  annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  author_email TEXT NOT NULL,
  author_github TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_replies_annotation
  ON annotation_replies(annotation_id);

-- -----------------------------------------------------------------------------
-- GitHub 同期キュー: Webhook 受信前の一時バッファ (Queue で処理)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL
       CHECK (kind IN ('annotation_created', 'annotation_updated',
                       'reply_created', 'issue_closed', 'issue_reopened',
                       'issue_commented')),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
       CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_events_status
  ON sync_events(status, created_at);
