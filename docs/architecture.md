# akaire Architecture

## Overview

`akaire` is a PDF feedback system with three main concerns:

1. **Viewer** — Browser-based PDF reading with highlight-and-comment UX
2. **API** — Persistent storage of annotations linked to PDF versions
3. **Sync** — Bidirectional sync with GitHub Issues for author workflow

All components run on Cloudflare's edge stack (Workers, Pages, D1, R2, Queues) to keep operational cost near zero for individual-scale use.

## Component Map

```
                Beta Reader (browser)
                        │ HTTPS
                        ↓
                Cloudflare Access
                (GitHub OAuth + allowlist)
                        │
                        ↓ JWT (email, gh handle)
   ┌────────────────┬───┴──────────┬────────────────────┐
   ↓                ↓              ↓                    ↓
┌──────────┐  ┌──────────┐  ┌───────────┐  ┌──────────────┐
│  Pages   │  │  Worker  │  │  Worker   │  │   Worker     │
│ (viewer) │  │ (pdf)    │  │ (api)     │  │ (sync-github)│
└──────────┘  └────┬─────┘  └─────┬─────┘  └──────┬───────┘
                   ↓              ↓                ↓
              ┌──────────┐   ┌──────────┐   ┌──────────────┐
              │   R2     │   │   D1     │←──│ GitHub Issues│
              │ (PDFs)   │   │(annot.)  │   │ (private)    │
              └──────────┘   └──────────┘   └──────────────┘
                                 ↑
                                 │
                            ┌─────────┐
                            │ Queue   │
                            │(events) │
                            └─────────┘
```

## Components

### Viewer (`packages/viewer/`)

- **Framework**: Svelte (軽量、PDF.js との統合が素直)
- **PDF rendering**: [PDF.js](https://mozilla.github.io/pdf.js/) with text layer enabled
- **Annotation overlay**: Custom absolute-positioned divs synchronized with PDF canvas
- **Auth**: Access JWT は Cloudflare が自動で添付する `Cf-Access-Jwt-Assertion` ヘッダから取得
- **Deploy**: Cloudflare Pages

UI layout:

```
┌─────────────────────────────────────────────────────┐
│  [←prev] [p.45 / 142] [next→]  [v2026-04-20▼]  [⚙]│
├───────────────────────────────────────┬─────────────┤
│                                       │  Thread     │
│                                       │  ─────────  │
│        PDF page                       │  3 comments │
│        (with hovering highlight       │  on page 45 │
│         rectangles)                   │             │
│                                       │  @alice     │
│                                       │  p.45 typo  │
│                                       │  ...        │
└───────────────────────────────────────┴─────────────┘
```

### PDF Server Worker (`packages/pdf-server/`)

- Route: `GET /pdf/:version_id`
- Auth: Cloudflare Access JWT verification
- Stream PDF bytes from R2 with Range support (for PDF.js partial fetch)
- Cache-Control: `private, max-age=3600`

### API Worker (`packages/api/`)

- Framework: [Hono](https://hono.dev/) on Workers
- Routes:
  - `POST /api/annotations` — create (emits `sync_event`)
  - `GET /api/annotations?version=X&page=P` — list
  - `GET /api/annotations/:id` — single with replies
  - `PATCH /api/annotations/:id` — update (status, kind, comment body)
  - `DELETE /api/annotations/:id`
  - `POST /api/annotations/:id/replies`
  - `POST /api/versions` — register a new PDF version + metadata
- Storage: D1 (see `db/schema.sql`)

### Sync GitHub Worker (`packages/sync-github/`)

- Consumes from Queue
- On `annotation_created` event:
  - Resolve `section_label` → chapter title via `pdf_versions.metadata_json`
  - Build Issue body (quote blockquote + comment + deeplink)
  - POST to GitHub API (with `GH_TOKEN` secret)
  - Write back `github_issue_number` to `annotations` row
- Webhook endpoint: `POST /webhook/github`
  - Verifies GitHub HMAC signature
  - On Issue closed → set annotation status to `resolved`
  - On Issue reopened → `open`
  - On Issue comment → append to `annotation_replies`

## Data Flow: New Annotation

```
1. User highlights text in viewer, types comment, submits
   ↓
2. Viewer POSTs to /api/annotations with:
   - version_id, page, quote, offsets, bbox, section_label, comment, kind
   - Access JWT (automatic)
   ↓
3. API Worker:
   - Verifies JWT, extracts author email
   - Inserts row into annotations
   - Enqueues {kind: 'annotation_created', id: ...} to GitHub sync queue
   - Returns 201 with annotation JSON
   ↓
4. Sync Worker (async):
   - Fetches annotation from D1
   - Resolves section metadata
   - Creates GitHub Issue
   - Updates D1 with github_issue_number
```

## Data Flow: Version Upgrade

```
1. Author builds new PDF locally:
   make dist
   # produces dist/book.pdf and build/book-metadata.json
   ↓
2. akaire upload CLI (TBD):
   - Computes version_id (git describe + page count hash)
   - Uploads PDF to R2
   - POSTs to /api/versions with metadata_json
   ↓
3. API Worker:
   - Inserts pdf_versions row
   - For each existing open annotation on previous version, trigger re-anchor:
     - Try to match quote in new PDF text
     - If found, copy annotation with new offsets/bbox, link to new version
     - If not found, mark as "orphan" and reference only section_label
   ↓
4. Viewer shows new version by default,
   with badge "3 annotations re-anchored, 1 orphan" for the author.
```

## Anchoring Strategy (3-layer fallback)

See [anchoring.md](anchoring.md) (TBD) for detail.

```
When rendering an annotation:

  If version matches creation version:
    Use bbox coordinates directly (fastest, exact)
  Else:
    Try to locate quote text in current PDF page:
      Using page_offset_start/end as hint
      Falling back to exact text search
    If found:
      Compute new bbox from located range
    Else:
      Display as "orphan" in section (section_label) scope
      Show warning to author for re-triage
```

## Security Model

- **Perimeter**: Cloudflare Access handles all auth. Workers trust the `Cf-Access-Jwt-Assertion` header and verify with Access's public keys.
- **Authorization**: Invite-only via Access policy. Self-hosters configure GitHub org membership or email allowlist.
- **Secrets**:
  - `GH_TOKEN` — GitHub app / PAT for Issue creation (Worker secret)
  - `GITHUB_WEBHOOK_SECRET` — HMAC verification key (Worker secret)
- **Isolation**: Each self-hosted instance has its own D1 / R2 / GitHub repo binding. No shared state.

## Deployment

See [self-hosting.md](../docs/self-hosting.md) (TBD) for setup walkthrough.

High-level:

1. Fork or clone
2. `infra/wrangler.toml` を自分の Cloudflare account で書き換え
3. `npm run db:migrate` で D1 セットアップ
4. `npm run deploy:all` で全 Worker + Pages デプロイ
5. Access のアプリケーション作成（手動、Cloudflare ダッシュボード）
6. GitHub App の作成（Issue 同期用）、`wrangler secret put GH_TOKEN`

## Open Questions

- **Viewer bundle size**: PDF.js だけで ~1MB。BlazeFast を最優先するか、機能性を優先するか
- **Multi-PDF support**: 1 account で複数書籍をホストする際のマルチテナンシー。Phase 2 以降
- **Offline support**: Service Worker でオフライン閲覧 → 再接続時同期。Phase 3
- **Collaboration features**: リアルタイム更新 (Durable Objects + WebSocket) は MVP では polling で代替
