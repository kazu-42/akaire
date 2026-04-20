// akaire API Worker — entry point
import { Hono } from "hono";
import { cors } from "hono/cors";
import { annotationsRouter } from "./annotations";
import { versionsRouter } from "./versions";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

// CORS は開発時・独自ドメインの viewer から叩くため開けておく。
// 本番は Access が前段にいるので、同一 tenant からしか到達しない。
app.use("*", cors());

app.get("/", (c) =>
  c.json({
    name: "akaire-api",
    version: "0.0.1",
    docs: "https://github.com/kazu-42/akaire",
  })
);

app.get("/healthz", (c) => c.json({ ok: true, ts: Date.now() }));

app.route("/api/annotations", annotationsRouter);
app.route("/api/versions", versionsRouter);

export default app;
