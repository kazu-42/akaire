// akaire PDF Server Worker
//
// GET /pdf/:version_id
//   - Access 認証済み前提 (Cf-Access-Jwt-Assertion は上流で検証)
//   - D1 で version_id → r2_key を解決
//   - R2 からストリーミングし、Range リクエストに対応

export interface Env {
  PDFS: R2Bucket;
  DB: D1Database;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_APP_AUD: string;
}

type VersionRow = {
  id: string;
  r2_key: string;
};

function parseRange(headerValue: string | null, size: number):
  | { start: number; end: number }
  | null {
  if (!headerValue) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(headerValue);
  if (!m) return null;
  const startStr = m[1];
  const endStr = m[2];
  if (startStr === "" && endStr === "") return null;
  if (startStr === "") {
    // suffix range: last N bytes
    const suffix = Number(endStr);
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startStr);
  const end = endStr === "" ? size - 1 : Math.min(Number(endStr), size - 1);
  if (start > end || start >= size) return null;
  return { start, end };
}

function accessAllowed(request: Request, env: Env): boolean {
  // 開発モード: ACCESS_APP_AUD が "TODO" の間は素通し。
  if (env.ACCESS_APP_AUD === "TODO") return true;
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  return jwt !== null;
  // TODO: JWKS で verify する
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return Response.json({ ok: true, ts: Date.now() });
    }

    const pdfMatch = url.pathname.match(/^\/pdf\/([^/]+)$/);
    if (!pdfMatch) {
      return new Response("not found", { status: 404 });
    }

    if (!accessAllowed(request, env)) {
      return new Response("unauthorized", { status: 401 });
    }

    const versionId = pdfMatch[1];
    const version = await env.DB.prepare(
      `SELECT id, r2_key FROM pdf_versions WHERE id = ?`
    )
      .bind(versionId)
      .first<VersionRow>();
    if (!version) {
      return new Response("version not found", { status: 404 });
    }

    const rangeHeader = request.headers.get("Range");

    // HEAD: サイズだけ返す
    if (request.method === "HEAD") {
      const head = await env.PDFS.head(version.r2_key);
      if (!head) return new Response("pdf object missing", { status: 404 });
      return new Response(null, {
        status: 200,
        headers: {
          "content-type": head.httpMetadata?.contentType ?? "application/pdf",
          "content-length": String(head.size),
          "accept-ranges": "bytes",
          "cache-control": "private, max-age=3600",
        },
      });
    }

    // Range なしは全体返却
    if (!rangeHeader) {
      const obj = await env.PDFS.get(version.r2_key);
      if (!obj) return new Response("pdf object missing", { status: 404 });
      return new Response(obj.body, {
        headers: {
          "content-type": obj.httpMetadata?.contentType ?? "application/pdf",
          "content-length": String(obj.size),
          "accept-ranges": "bytes",
          "cache-control": "private, max-age=3600",
        },
      });
    }

    // Range あり
    const head = await env.PDFS.head(version.r2_key);
    if (!head) return new Response("pdf object missing", { status: 404 });
    const range = parseRange(rangeHeader, head.size);
    if (!range) {
      return new Response("invalid range", { status: 416 });
    }

    const obj = await env.PDFS.get(version.r2_key, {
      range: { offset: range.start, length: range.end - range.start + 1 },
    });
    if (!obj) return new Response("pdf object missing", { status: 404 });

    return new Response(obj.body, {
      status: 206,
      headers: {
        "content-type": head.httpMetadata?.contentType ?? "application/pdf",
        "content-range": `bytes ${range.start}-${range.end}/${head.size}`,
        "content-length": String(range.end - range.start + 1),
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=3600",
      },
    });
  },
};
