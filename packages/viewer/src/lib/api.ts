import type { Annotation, NewAnnotation, PDFVersion, Reply } from "./types";

// 実運用の URL はビルド時の env で切り替えたいが、とりあえず固定。
// 独自ドメイン設定後に書き換える。
export const API_BASE = (() => {
  const override = (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE;
  if (override) return override;
  // production default
  return "https://akaire-api.ghive42.workers.dev";
})();

export const PDF_BASE = (() => {
  const override = (import.meta as { env?: { VITE_PDF_BASE?: string } }).env?.VITE_PDF_BASE;
  if (override) return override;
  return "https://akaire-pdf-server.ghive42.workers.dev";
})();

// 開発中のユーザ識別 (Access を通していない場合のフォールバック)
function devHeaders(): Record<string, string> {
  const email = localStorage.getItem("akaire.dev_email");
  const github = localStorage.getItem("akaire.dev_github");
  const headers: Record<string, string> = {};
  if (email) headers["X-Dev-Email"] = email;
  if (github) headers["X-Dev-Github"] = github;
  return headers;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  async getVersion(versionId: string): Promise<PDFVersion> {
    const res = await fetch(`${API_BASE}/api/versions/${encodeURIComponent(versionId)}`, {
      credentials: "include",
      headers: devHeaders(),
    });
    return json(res);
  },

  async listAnnotations(
    versionId: string,
    options: { page?: number; status?: string } = {}
  ): Promise<Annotation[]> {
    const qs = new URLSearchParams({ version: versionId });
    if (options.page !== undefined) qs.set("page", String(options.page));
    if (options.status) qs.set("status", options.status);
    const res = await fetch(`${API_BASE}/api/annotations?${qs}`, {
      credentials: "include",
      headers: devHeaders(),
    });
    const data = await json<{ annotations: Annotation[] }>(res);
    return data.annotations;
  },

  async createAnnotation(payload: NewAnnotation): Promise<Annotation> {
    const res = await fetch(`${API_BASE}/api/annotations`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...devHeaders(),
      },
      body: JSON.stringify(payload),
    });
    return json(res);
  },

  async getAnnotation(id: string): Promise<{ annotation: Annotation; replies: Reply[] }> {
    const res = await fetch(`${API_BASE}/api/annotations/${encodeURIComponent(id)}`, {
      credentials: "include",
      headers: devHeaders(),
    });
    return json(res);
  },

  async updateAnnotation(
    id: string,
    patch: Partial<Pick<Annotation, "comment" | "kind" | "status">>
  ): Promise<Annotation> {
    const res = await fetch(`${API_BASE}/api/annotations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...devHeaders(),
      },
      body: JSON.stringify(patch),
    });
    return json(res);
  },

  async addReply(annotationId: string, body: string): Promise<Reply> {
    const res = await fetch(
      `${API_BASE}/api/annotations/${encodeURIComponent(annotationId)}/replies`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...devHeaders(),
        },
        body: JSON.stringify({ body }),
      }
    );
    return json(res);
  },

  pdfUrl(versionId: string): string {
    return `${PDF_BASE}/pdf/${encodeURIComponent(versionId)}`;
  },
};
