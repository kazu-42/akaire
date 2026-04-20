// Cloudflare Access JWT 検証 (最小実装)
//
// Access アプリケーションは各リクエストに以下のヘッダを付与する:
//   Cf-Access-Jwt-Assertion: <JWT>
// ペイロードの主要クレーム:
//   - aud: Access アプリケーションの AUD タグ
//   - email: ログインユーザのメール
//   - identity_nonce: セッション識別
//   - iss: https://{team}.cloudflareaccess.com
//
// 公開鍵 (JWKS) は https://{team}.cloudflareaccess.com/cdn-cgi/access/certs
// から取得できる。本実装は verify を省略し、Access がプロキシで検証済みである前提で
// payload を decode するだけの簡易版。
//
// TODO: 実運用前に JWKS を用いた verify を追加する (jose パッケージ等)。

import { createMiddleware } from "hono/factory";
import type { Env } from "./env";

export interface AccessUser {
  email: string;
  github_handle?: string;
  identity_nonce?: string;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1];
    // base64url デコード
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const text = atob(padded);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const accessMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { user: AccessUser };
}>(async (c, next) => {
  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (!jwt) {
    // 開発時に Access ヘッダなしで叩く場合の fallback。
    // 本番では Access 必須。wrangler.toml の ACCESS_APP_AUD が "TODO" の
    // 間は開発モードとして通過させる。
    if (c.env.ACCESS_APP_AUD === "TODO") {
      c.set("user", {
        email: c.req.header("X-Dev-Email") ?? "dev@example.com",
        github_handle: c.req.header("X-Dev-Github") ?? undefined,
      });
      await next();
      return;
    }
    return c.json({ error: "missing Access JWT" }, 401);
  }

  const payload = decodeJwtPayload(jwt);
  if (!payload || typeof payload.email !== "string") {
    return c.json({ error: "invalid Access JWT" }, 401);
  }

  c.set("user", {
    email: payload.email,
    github_handle:
      typeof payload.custom === "object" && payload.custom !== null
        ? (payload.custom as { github_login?: string }).github_login
        : undefined,
    identity_nonce: payload.identity_nonce as string | undefined,
  });
  await next();
});
