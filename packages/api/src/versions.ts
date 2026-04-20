// PDF バージョン登録 (書籍ビルド側から叩く管理 API)
import { Hono } from "hono";
import type { Env } from "./env";
import { accessMiddleware, type AccessUser } from "./access";

type VersionRow = {
  id: string;
  r2_key: string;
  git_commit: string | null;
  built_at: number;
  page_count: number;
  label: string | null;
  metadata_json: string | null;
};

type AppVars = { user: AccessUser };

export const versionsRouter = new Hono<{
  Bindings: Env;
  Variables: AppVars;
}>();

versionsRouter.use("*", accessMiddleware);

// POST /api/versions
versionsRouter.post("/", async (c) => {
  const body = (await c.req.json()) as Partial<VersionRow> & {
    id?: string;
    r2_key?: string;
    page_count?: number;
  };

  if (!body.id || !body.r2_key || typeof body.page_count !== "number") {
    return c.json({ error: "id, r2_key, page_count required" }, 400);
  }

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO pdf_versions (
       id, r2_key, git_commit, built_at, page_count, label, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.id,
      body.r2_key,
      body.git_commit ?? null,
      body.built_at ?? Date.now(),
      body.page_count,
      body.label ?? null,
      body.metadata_json ?? null
    )
    .run();

  const created = await c.env.DB.prepare(
    `SELECT * FROM pdf_versions WHERE id = ?`
  )
    .bind(body.id)
    .first<VersionRow>();
  return c.json(created, 201);
});

// GET /api/versions
versionsRouter.get("/", async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT id, r2_key, git_commit, built_at, page_count, label
       FROM pdf_versions ORDER BY built_at DESC`
  ).all<VersionRow>();
  return c.json({ versions: result.results ?? [] });
});

// GET /api/versions/:id
versionsRouter.get("/:id", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT * FROM pdf_versions WHERE id = ?`
  )
    .bind(c.req.param("id"))
    .first<VersionRow>();
  if (!row) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json(row);
});
