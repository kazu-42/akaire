# akaire

> 赤入れ — PDF feedback system with highlight-and-comment UX, self-hostable on Cloudflare.

`akaire` は、レビュワーが PDF の任意の範囲をハイライトしてコメントを残せる、自己ホスト型のフィードバック収集システムです。書籍の β 配布、技術書典出展者のレビュー回収、論文原稿のフィードバック、社内資料のレビューなど、"PDF への赤入れ" を要する場面で使えます。

## 特徴

- **ブラウザ上で直接 PDF を開き、範囲選択でコメント** — Google Docs 的な UX を PDF で
- **GitHub Issue 双方向同期** — 著者は既存の Issue ワークフローで捌ける
- **バージョンまたぎのアンカー永続性** — 3 層フォールバック（座標 / quote / 章ラベル）で、改訂後も指摘が辿れる
- **Cloudflare 一式** — Access + Pages + Workers + D1 + R2 + Queues。無料枠でほぼ動く
- **LaTeX ビルドと統合しやすい** — `.aux` ファイルから章・節メタデータを自動抽出できる
- **招待制** — Cloudflare Access の GitHub OAuth + email allowlist で閉じた β レビューに最適

## 現状

**Pre-MVP**. 設計が確定した段階で、実装はこれから。最初のドッグフーディングは [Just Quality](https://github.com/kazu-42/JustQuality)（書籍プロジェクト）で行います。

進捗は [Issues](https://github.com/kazu-42/akaire/issues) と ADR (`docs/adr/`) で追えます。

## アーキテクチャ

```
               Beta Reader (browser)
                        │
                        ↓ HTTPS
               Cloudflare Access
               (GitHub OAuth + allowlist)
                        │
                        ↓ JWT
   ┌────────────┬───────┴──────┬───────────────┐
   ↓            ↓              ↓               ↓
 Pages      Worker          Worker          Worker
(viewer)   (pdf-server)    (api)          (sync-github)
                │              │               │
                ↓              ↓               ↓
              R2            D1              GitHub Issues
           (PDFs)        (annotations)     (private)
```

詳細は [docs/architecture.md](docs/architecture.md) 参照。

## ディレクトリ構成

```
akaire/
├── packages/
│   ├── viewer/        Svelte + PDF.js (Cloudflare Pages)
│   ├── api/           Hono on Cloudflare Worker (annotations)
│   ├── pdf-server/    Cloudflare Worker (auth + R2 stream)
│   └── sync-github/   Cloudflare Worker + Queues (Issue sync)
├── db/
│   ├── schema.sql     D1 schema
│   └── migrations/
├── infra/
│   ├── wrangler.toml
│   └── cloudflare-access-policy.yml
├── docs/
│   ├── architecture.md
│   ├── self-hosting.md
│   └── anchoring.md
└── examples/
    └── justquality/   実運用事例 (Just Quality 書籍)
```

## セルフホスト

詳細手順は [docs/self-hosting.md](docs/self-hosting.md) (TBD)。概略:

1. Cloudflare アカウントで D1 / R2 / Workers / Pages / Access をプロビジョン
2. `wrangler.toml` に bucket 名・D1 ID を記入
3. `npm install && npm run deploy:all`
4. Access のポリシーで許可する GitHub org / email を設定
5. `akaire upload <path>.pdf` で PDF 登録

## 貢献

[CONTRIBUTING.md](CONTRIBUTING.md) 参照。現段階は設計フェーズなので、Issues での議論歓迎。

## ライセンス

Apache-2.0. See [LICENSE](LICENSE).

Copyright 2026 kazu42.
