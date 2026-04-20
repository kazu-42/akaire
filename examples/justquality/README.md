# Just Quality — akaire 運用事例

[Just Quality](https://github.com/kazu-42/JustQuality) (private) は akaire の最初のドッグフーディング対象。

## 構成

- 本書リポ (`kazu-42/JustQuality`) の `app/akaire/` に本 OSS を submodule として組み込み
- 本書固有設定は `app/akaire-config/` (非 submodule、本書 repo 内で管理)
- PDF は β 期間中は R2 に版ごとにアップロードされる (`v2026-04-20-142p-<gitsha>`)
- GitHub Issue は `kazu-42/JustQuality` (private) に `label:akaire/` 付きで作成される

## ビルド連携

本書の `Makefile` で `make metadata` タスクが動き、`build/book-metadata.json` に章・節ラベルとページ情報をダンプする。これを akaire upload 時に `pdf_versions.metadata_json` として登録。

## 当面の運用範囲

- 招待レビュワー: 数名 (Access email allowlist)
- PDF バージョン: 週 1〜2 回の更新
- フィードバック規模: 章あたり数十件想定
