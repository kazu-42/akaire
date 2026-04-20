// akaire GitHub Sync Worker
//
// 2 つの責務:
//   1. Queue consumer: annotation_created/updated, reply_created を受けて
//      GitHub Issue の作成・更新を行う
//   2. HTTP handler: GitHub からの webhook を受け、D1 にステータスを同期

export interface SyncEvent {
  kind: string;
  id: string;
  annotation_id?: string;
}

export interface Env {
  DB: D1Database;
  GITHUB_REPO: string;
  GITHUB_ISSUE_LABEL_PREFIX: string;
  VIEWER_BASE_URL: string;
  GH_TOKEN: string;
  GITHUB_WEBHOOK_SECRET: string;
}

type AnnotationRow = {
  id: string;
  version_id: string;
  author_email: string;
  author_github: string | null;
  page: number;
  quote: string;
  section_label: string | null;
  comment: string;
  kind: string;
  status: string;
  github_issue_number: number | null;
};

type VersionRow = {
  id: string;
  metadata_json: string | null;
};

type ChapterMeta = {
  label: string;
  number: string;
  title: string;
  page: number;
};

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function resolveChapter(
  sectionLabel: string | null,
  metadataJson: string | null,
  page: number
): ChapterMeta | null {
  if (!metadataJson) return null;
  try {
    const meta = JSON.parse(metadataJson) as {
      chapters?: ChapterMeta[];
    };
    const chapters = meta.chapters ?? [];
    // セクションラベルから直接引ける場合
    if (sectionLabel) {
      const byLabel = chapters.find((c) => c.label === sectionLabel);
      if (byLabel) return byLabel;
    }
    // そうでなければ、ページが含まれる章を「開始ページ ≤ page」で最大のものとして推測
    const candidates = chapters
      .filter((c) => c.page <= page)
      .sort((a, b) => b.page - a.page);
    return candidates[0] ?? null;
  } catch {
    return null;
  }
}

async function createIssue(
  env: Env,
  annotation: AnnotationRow,
  chapter: ChapterMeta | null
): Promise<number | null> {
  const chapterNumber = chapter?.number ?? "?";
  const quoteShort = truncate(annotation.quote, 60);
  const title = `[p.${annotation.page} / ch.${chapterNumber}] ${annotation.kind}: ${quoteShort}`;

  const viewerUrl = `${env.VIEWER_BASE_URL}/view/${annotation.version_id}#p${annotation.page}-aid-${annotation.id}`;
  const body = [
    `> ${annotation.quote.replace(/\n/g, "\n> ")}`,
    "",
    `💬 ${annotation.author_github ? `@${annotation.author_github}` : annotation.author_email} says:`,
    "",
    annotation.comment,
    "",
    "---",
    `📖 PDF version: \`${annotation.version_id}\``,
    `🔗 [Open in akaire viewer](${viewerUrl})`,
  ].join("\n");

  const labels = [
    `${env.GITHUB_ISSUE_LABEL_PREFIX}${annotation.kind}`,
    `${env.GITHUB_ISSUE_LABEL_PREFIX}version/${annotation.version_id}`,
  ];
  if (chapter) {
    labels.push(`${env.GITHUB_ISSUE_LABEL_PREFIX}ch/${chapter.number}`);
  }

  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GH_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "akaire/0.0.1",
    },
    body: JSON.stringify({ title, body, labels }),
  });
  if (!res.ok) {
    console.error("GitHub Issue create failed", res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as { number: number };
  return data.number;
}

async function handleAnnotationCreated(env: Env, id: string): Promise<void> {
  const annotation = await env.DB.prepare(
    `SELECT * FROM annotations WHERE id = ?`
  )
    .bind(id)
    .first<AnnotationRow>();
  if (!annotation) return;
  if (annotation.github_issue_number !== null) return; // 既に作られている

  const version = await env.DB.prepare(
    `SELECT id, metadata_json FROM pdf_versions WHERE id = ?`
  )
    .bind(annotation.version_id)
    .first<VersionRow>();
  const chapter = resolveChapter(
    annotation.section_label,
    version?.metadata_json ?? null,
    annotation.page
  );

  const issueNumber = await createIssue(env, annotation, chapter);
  if (issueNumber !== null) {
    await env.DB.prepare(
      `UPDATE annotations SET github_issue_number = ?, updated_at = ? WHERE id = ?`
    )
      .bind(issueNumber, Date.now(), id)
      .run();
  }
}

async function verifyWebhookSignature(
  request: Request,
  secret: string,
  body: string
): Promise<boolean> {
  const signature = request.headers.get("X-Hub-Signature-256");
  if (!signature) return false;

  const expected = "sha256=" + (await hmacSha256(secret, body));
  return timingSafeEqual(signature, expected);
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

type WebhookPayload = {
  action: string;
  issue?: { number: number; state?: string };
  comment?: { body: string; user?: { login: string } };
};

export default {
  // HTTP handler: GitHub webhook 受信
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/webhook/github") {
      const body = await request.text();
      const valid = await verifyWebhookSignature(request, env.GITHUB_WEBHOOK_SECRET, body);
      if (!valid) return new Response("invalid signature", { status: 401 });
      const payload = JSON.parse(body) as WebhookPayload;

      if (payload.action === "closed" && payload.issue) {
        await env.DB.prepare(
          `UPDATE annotations SET status = 'resolved', updated_at = ?
             WHERE github_issue_number = ? AND status = 'open'`
        )
          .bind(Date.now(), payload.issue.number)
          .run();
      } else if (payload.action === "reopened" && payload.issue) {
        await env.DB.prepare(
          `UPDATE annotations SET status = 'open', updated_at = ?
             WHERE github_issue_number = ?`
        )
          .bind(Date.now(), payload.issue.number)
          .run();
      } else if (payload.action === "created" && payload.issue && payload.comment) {
        // Issue へのコメントを annotation_replies に転記
        const annotation = await env.DB.prepare(
          `SELECT id FROM annotations WHERE github_issue_number = ?`
        )
          .bind(payload.issue.number)
          .first<{ id: string }>();
        if (annotation) {
          const replyId = crypto.randomUUID();
          await env.DB.prepare(
            `INSERT INTO annotation_replies
               (id, annotation_id, author_email, author_github, body, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`
          )
            .bind(
              replyId,
              annotation.id,
              payload.comment.user?.login
                ? `${payload.comment.user.login}@github`
                : "github@unknown",
              payload.comment.user?.login ?? null,
              payload.comment.body,
              Date.now()
            )
            .run();
        }
      }
      return Response.json({ ok: true });
    }
    if (url.pathname === "/healthz") {
      return Response.json({ ok: true, ts: Date.now() });
    }
    return new Response("not found", { status: 404 });
  },

  // Queue consumer: annotation_created などを受けて Issue 作成
  async queue(batch: MessageBatch<SyncEvent>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const event = message.body;
      try {
        if (event.kind === "annotation_created") {
          await handleAnnotationCreated(env, event.id);
        } else if (event.kind === "annotation_updated") {
          // TODO: Issue の status / kind 変更を反映
          console.log("annotation_updated (todo)", event.id);
        } else if (event.kind === "reply_created") {
          // TODO: Issue にコメント追加
          console.log("reply_created (todo)", event.id);
        }
        message.ack();
      } catch (err) {
        console.error("sync-github error", err);
        message.retry();
      }
    }
  },
};
