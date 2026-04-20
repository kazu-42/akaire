// アノテーション CRUD ルート
import { Hono } from "hono";
import type { Env, SyncEvent } from "./env";
import { accessMiddleware, type AccessUser } from "./access";

type AnnotationRow = {
  id: string;
  version_id: string;
  author_email: string;
  author_github: string | null;
  page: number;
  quote: string;
  page_offset_start: number | null;
  page_offset_end: number | null;
  bbox_x1: number | null;
  bbox_y1: number | null;
  bbox_x2: number | null;
  bbox_y2: number | null;
  section_label: string | null;
  comment: string;
  kind: string;
  status: string;
  github_issue_number: number | null;
  created_at: number;
  updated_at: number;
};

type ReplyRow = {
  id: string;
  annotation_id: string;
  author_email: string;
  author_github: string | null;
  body: string;
  created_at: number;
};

const ALLOWED_KINDS = new Set([
  "comment",
  "typo",
  "suggestion",
  "question",
  "praise",
]);
const ALLOWED_STATUSES = new Set([
  "open",
  "resolved",
  "wontfix",
  "duplicate",
]);

function uuid(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

type AppVars = { user: AccessUser };

export const annotationsRouter = new Hono<{
  Bindings: Env;
  Variables: AppVars;
}>();

annotationsRouter.use("*", accessMiddleware);

// POST /api/annotations
annotationsRouter.post("/", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json()) as Partial<AnnotationRow> & {
    version_id?: string;
    page?: number;
    quote?: string;
    comment?: string;
  };

  if (!body.version_id || typeof body.page !== "number" || !body.quote || !body.comment) {
    return c.json({ error: "missing required fields" }, 400);
  }
  const kind = body.kind ?? "comment";
  if (!ALLOWED_KINDS.has(kind)) {
    return c.json({ error: `invalid kind: ${kind}` }, 400);
  }

  const id = uuid();
  const ts = now();
  await c.env.DB.prepare(
    `INSERT INTO annotations (
       id, version_id, author_email, author_github,
       page, quote, page_offset_start, page_offset_end,
       bbox_x1, bbox_y1, bbox_x2, bbox_y2,
       section_label, comment, kind, status,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
  )
    .bind(
      id,
      body.version_id,
      user.email,
      user.github_handle ?? null,
      body.page,
      body.quote,
      body.page_offset_start ?? null,
      body.page_offset_end ?? null,
      body.bbox_x1 ?? null,
      body.bbox_y1 ?? null,
      body.bbox_x2 ?? null,
      body.bbox_y2 ?? null,
      body.section_label ?? null,
      body.comment,
      kind,
      ts,
      ts
    )
    .run();

  // GitHub 同期キューにエンキュー
  const event: SyncEvent = { kind: "annotation_created", id };
  await c.env.SYNC_QUEUE.send(event);

  const created = await c.env.DB.prepare(`SELECT * FROM annotations WHERE id = ?`)
    .bind(id)
    .first<AnnotationRow>();
  return c.json(created, 201);
});

// GET /api/annotations?version=...&page=...
annotationsRouter.get("/", async (c) => {
  const version = c.req.query("version");
  const pageStr = c.req.query("page");
  const status = c.req.query("status") ?? "open";

  if (!version) {
    return c.json({ error: "version query param required" }, 400);
  }

  let sql =
    `SELECT * FROM annotations WHERE version_id = ? AND status = ?`;
  const params: (string | number)[] = [version, status];
  if (pageStr) {
    sql += " AND page = ?";
    params.push(Number(pageStr));
  }
  sql += " ORDER BY page ASC, created_at ASC";

  const result = await c.env.DB.prepare(sql).bind(...params).all<AnnotationRow>();
  return c.json({ annotations: result.results ?? [] });
});

// GET /api/annotations/:id
annotationsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const annotation = await c.env.DB.prepare(
    `SELECT * FROM annotations WHERE id = ?`
  )
    .bind(id)
    .first<AnnotationRow>();
  if (!annotation) {
    return c.json({ error: "not found" }, 404);
  }
  const replies = await c.env.DB.prepare(
    `SELECT * FROM annotation_replies WHERE annotation_id = ? ORDER BY created_at ASC`
  )
    .bind(id)
    .all<ReplyRow>();
  return c.json({ annotation, replies: replies.results ?? [] });
});

// PATCH /api/annotations/:id
annotationsRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as Partial<AnnotationRow>;

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.comment !== undefined) {
    updates.push("comment = ?");
    values.push(body.comment);
  }
  if (body.kind !== undefined) {
    if (!ALLOWED_KINDS.has(body.kind)) {
      return c.json({ error: `invalid kind: ${body.kind}` }, 400);
    }
    updates.push("kind = ?");
    values.push(body.kind);
  }
  if (body.status !== undefined) {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return c.json({ error: `invalid status: ${body.status}` }, 400);
    }
    updates.push("status = ?");
    values.push(body.status);
  }
  if (updates.length === 0) {
    return c.json({ error: "nothing to update" }, 400);
  }
  updates.push("updated_at = ?");
  values.push(now());
  values.push(id);

  await c.env.DB.prepare(
    `UPDATE annotations SET ${updates.join(", ")} WHERE id = ?`
  )
    .bind(...values)
    .run();

  await c.env.SYNC_QUEUE.send({ kind: "annotation_updated", id });

  const updated = await c.env.DB.prepare(`SELECT * FROM annotations WHERE id = ?`)
    .bind(id)
    .first<AnnotationRow>();
  return c.json(updated);
});

// DELETE /api/annotations/:id
annotationsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare(`DELETE FROM annotations WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

// POST /api/annotations/:id/replies
annotationsRouter.post("/:id/replies", async (c) => {
  const user = c.get("user");
  const annotationId = c.req.param("id");
  const body = (await c.req.json()) as { body?: string };
  if (!body.body) {
    return c.json({ error: "body required" }, 400);
  }
  const id = uuid();
  const ts = now();
  await c.env.DB.prepare(
    `INSERT INTO annotation_replies (id, annotation_id, author_email, author_github, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, annotationId, user.email, user.github_handle ?? null, body.body, ts)
    .run();

  await c.env.SYNC_QUEUE.send({
    kind: "reply_created",
    id,
    annotation_id: annotationId,
  });

  const created = await c.env.DB.prepare(
    `SELECT * FROM annotation_replies WHERE id = ?`
  )
    .bind(id)
    .first<ReplyRow>();
  return c.json(created, 201);
});
