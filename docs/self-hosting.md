# akaire セルフホスト手順

自分の Cloudflare アカウントに akaire を一式デプロイする手順。
本ドキュメントは [Just Quality](https://github.com/kazu-42/JustQuality) 用インスタンスを例に書いているが、他の書籍・プロジェクトでも同じ流れで構築できる。

## 前提

- Cloudflare アカウント（無料枠で十分）
- Node.js 20 以上 + npm
- `wrangler` が CLI で動くこと（`npx wrangler` でも可）
- GitHub アカウントと、連携先の Issue を作る repo の write 権限
- `pdfinfo` コマンド（書籍メタデータ抽出に使う場合、`poppler` 系パッケージ）

## 0. リポジトリ取得

```sh
git clone https://github.com/kazu-42/akaire.git
cd akaire
npm install
```

## 1. Cloudflare リソース作成

```sh
# D1 (構造化データ)
npx wrangler d1 create <project>-akaire
# → database_id をメモ

# R2 (PDF バイナリ格納)
npx wrangler r2 bucket create <project>-akaire-pdfs

# Queue (GitHub 同期のイベントバス)
npx wrangler queues create <project>-akaire-sync
```

取得した `database_id` を `packages/api/wrangler.toml`、`packages/pdf-server/wrangler.toml`、`packages/sync-github/wrangler.toml` の該当箇所に書き込む。
R2 の `bucket_name`、Queue の名前も同様に書き換える（プロジェクト名プレフィックスを使い回す）。

## 2. D1 スキーマ適用

```sh
npx wrangler d1 execute <project>-akaire --remote --file=db/schema.sql
```

`_cf_KV` が自動作成される他に、以下の 4 テーブルが作られれば OK:

```sh
npx wrangler d1 execute <project>-akaire --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
# → annotation_replies, annotations, pdf_versions, sync_events, _cf_KV
```

## 3. Workers をデプロイ（Access より前にできる）

```sh
cd packages/api        && npx wrangler deploy && cd -
cd packages/pdf-server && npx wrangler deploy && cd -
cd packages/sync-github && npx wrangler deploy && cd -
```

デプロイ後のエンドポイント:

- `https://akaire-api.<account>.workers.dev`
- `https://akaire-pdf-server.<account>.workers.dev`
- `https://akaire-sync-github.<account>.workers.dev`

`/healthz` で疎通確認:

```sh
curl https://akaire-api.<account>.workers.dev/healthz
# {"ok":true,"ts":...}
```

`ACCESS_APP_AUD` が `"TODO"` のままだと API は開発モードで動作する（`X-Dev-Email` ヘッダで任意ユーザとして操作可能）。本番運用時は Access 設定後に `ACCESS_APP_AUD` を実値に書き換えて再デプロイする。

## 4. Viewer をデプロイ

```sh
cd packages/viewer
npm run build
npx wrangler pages project create akaire-viewer --production-branch=main
npx wrangler pages deploy dist --project-name=akaire-viewer --commit-dirty=true
```

→ `https://akaire-viewer.pages.dev`

`src/lib/api.ts` の `API_BASE` / `PDF_BASE` を自分の Workers のドメインに書き換えてから再ビルド・再デプロイする。または、ビルド時の環境変数で差し替える:

```sh
VITE_API_BASE=https://akaire-api.<account>.workers.dev \
VITE_PDF_BASE=https://akaire-pdf-server.<account>.workers.dev \
npm run build
```

## 5. Cloudflare Access でゲートを張る

ここは**ダッシュボード操作が必要**。Wrangler からは API 経由の自動化が限定的なため、手動が現実的。

### 5.1 Access アプリケーション作成

1. Cloudflare ダッシュ → Zero Trust → Access → Applications
2. **Add an application** → **Self-hosted**
3. Application name: `akaire-viewer`
4. Domain: `akaire-viewer.pages.dev` （または独自ドメイン）
5. Session duration: `24 hours`（好み）
6. **Next**

### 5.2 Identity provider 設定

Zero Trust → Settings → Authentication → Login methods に GitHub OAuth を追加:

1. **Add new** → **GitHub**
2. GitHub 側で OAuth App 作成 (GitHub Settings → Developer settings → OAuth Apps):
   - Authorization callback URL: `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback`
   - Client ID と Secret を Cloudflare に入力
3. **Test** で動作確認

### 5.3 ポリシー設定

Access アプリケーション設定画面で:

1. **Policies** → **Add a policy**
2. Action: `Allow`
3. Rule:
   - Include → **Emails**: `kazu42@example.com` など許可するメールを列挙
   - または **GitHub organization**: `kazu-42-reviewers` のような org メンバー全員を許可
4. Save

### 5.4 Workers にも Access を適用（API・PDF サーバ）

Viewer だけでなく、API Worker と PDF Server Worker にも Access を被せる。

Workers は pages.dev と違って自動的にカスタムドメインにならないので、**独自ドメインを用意するか** Cloudflare のワイルドカード DNS を使う必要がある。

**独自ドメイン（推奨）**:

1. Cloudflare DNS でルート `yourdomain.com` を用意
2. Workers のドメイン設定で以下をマッピング:
   - `api.yourdomain.com` → `akaire-api`
   - `pdf.yourdomain.com` → `akaire-pdf-server`
   - `viewer.yourdomain.com` → `akaire-viewer` (Pages)
3. 上記 3 つのホストを **同じ Access アプリケーション**に含める

### 5.5 AUD を取得して Workers 設定に反映

Access アプリの **Overview** に **Application Audience (AUD) Tag** が表示される。
これを各 Worker の `wrangler.toml` に書き込む:

```toml
[vars]
ACCESS_TEAM_DOMAIN = "<team-name>.cloudflareaccess.com"
ACCESS_APP_AUD = "abc123...実値..."
```

書き換えたら再デプロイ:

```sh
cd packages/api && npx wrangler deploy
cd packages/pdf-server && npx wrangler deploy
```

これで Access 経由のアクセスのみ受け付けるようになる。

## 6. GitHub 同期の secrets 設定

### 6.1 GitHub Personal Access Token (または GitHub App)

Issue 作成用トークン。最小権限:

- Fine-grained PAT (推奨):
  - Repository access: 連携先 repo だけ
  - Permissions: **Issues: Read and write**
- または classic PAT:
  - Scope: `repo` (private repo の場合) または `public_repo`

### 6.2 Webhook シークレット

受信側 HMAC 検証用の共有秘密。任意の十分長いランダム文字列。

```sh
openssl rand -hex 32
# → 64 文字の hex 文字列
```

### 6.3 Worker に secret を設定

```sh
cd packages/sync-github
echo -n "ghp_xxxxxxxxxxxxxxxxxxxx" | npx wrangler secret put GH_TOKEN
echo -n "<64-char-hex>" | npx wrangler secret put GITHUB_WEBHOOK_SECRET
```

### 6.4 GitHub 側で webhook 登録

連携先 repo → Settings → Webhooks → Add webhook:

- Payload URL: `https://akaire-sync-github.<account>.workers.dev/webhook/github`（または Access 経由のドメイン）
- Content type: `application/json`
- Secret: `GITHUB_WEBHOOK_SECRET` に設定した値
- Which events: **Let me select**
  - ✓ Issues
  - ✓ Issue comments

## 7. 動作確認

### PDF アップロード

```sh
cd /path/to/your-book
make dist  # PDF + metadata.json を生成
/path/to/akaire/packages/cli/bin/akaire.mjs upload \
  dist/book.pdf dist/book-metadata.json \
  --label="Beta v1"
```

→ viewer URL が表示される。

### ビューアで動作確認

1. 表示された URL にブラウザでアクセス
2. Access のログイン画面（GitHub OAuth）が出る
3. 許可されたアカウントでログイン
4. PDF が表示される
5. 任意の範囲を選択 → コメントダイアログが出る
6. 送信すると右サイドバーに反映
7. 連携先 GitHub repo に Issue が作られる

### GitHub 同期確認

```sh
curl https://akaire-sync-github.<account>.workers.dev/healthz
# {"ok":true,...}
```

Issue を手動で close すると、数秒で viewer の該当アノテーションが `status=resolved` になる（ポーリングで反映）。

## 8. 複数プロジェクト対応（将来）

現状の akaire は 1 instance = 1 project 前提。複数書籍を扱いたい場合:

- D1 テーブルに `project_id` 列を追加
- Versions / annotations をプロジェクトごとに分離
- viewer の URL にプロジェクト識別子を追加 (`#/view/<project>/<version>`)

この拡張は issue で議論する予定。

## トラブルシューティング

### `Cf-Access-Jwt-Assertion` が付かない

Access アプリケーションの domain 設定が実際のドメインと一致していない可能性。ダッシュで再確認。

### viewer で CORS エラー

API Worker の `cors()` は全許可だが、Access が前段にいる場合 preflight が跳ねることがある。**全エンドポイントを同じ Access アプリケーションに含める**のが最も単純な解。

### PDF が 404

- `akaire list-versions` で version が登録されているか確認
- `npx wrangler r2 object get <bucket>/pdfs/<version>.pdf` で R2 上のオブジェクト存在を確認
- `wrangler.toml` の R2 binding 名が `PDFS` になっているか確認

### Issue が作られない

- `GH_TOKEN` secret が正しく設定されているか: `npx wrangler secret list`
- Worker のログ: `npx wrangler tail akaire-sync-github`
- Queue に溜まっているか: Cloudflare ダッシュ → Queues → `*-akaire-sync`
