// akaire API Worker — entry point
import { Hono } from "hono";
import { cors } from "hono/cors";
import { annotationsRouter } from "./annotations";
import { versionsRouter } from "./versions";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

// CORS: credentials: 'include' を通すために wildcard ではなく明示 origin を返す。
// Viewer は pages.dev。独自ドメイン化したら追加する。
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return "*";
      if (origin.endsWith(".akaire-viewer.pages.dev")) return origin;
      if (origin === "https://akaire-viewer.pages.dev") return origin;
      if (origin.startsWith("http://localhost:")) return origin;
      return null;
    },
    credentials: true,
    allowHeaders: [
      "Content-Type",
      "X-Dev-Email",
      "X-Dev-Github",
      "Cf-Access-Jwt-Assertion",
    ],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })
);

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
