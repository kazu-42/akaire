#!/usr/bin/env node
// akaire CLI — PDF 版のアップロードと管理
//
// Usage:
//   akaire upload <pdf> <metadata.json> [--label=...]
//   akaire list-versions
//
// 設定 (環境変数):
//   AKAIRE_API     API Worker の URL (既定: https://akaire-api.ghive42.workers.dev)
//   AKAIRE_PDF_SERVER  PDF Worker の URL (既定: https://akaire-pdf-server.ghive42.workers.dev)
//   AKAIRE_DEV_EMAIL   開発モード時の X-Dev-Email ヘッダ
//
// R2 へのアップロードは wrangler を subprocess 経由で行う:
//   wrangler r2 object put justquality-akaire-pdfs/<key> --file=<path>
//
// これは MVP。将来は直接 API 経由アップロード (署名付き URL など) に置き換え予定。

import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const API = process.env.AKAIRE_API ?? "https://akaire-api.ghive42.workers.dev";
const R2_BUCKET = process.env.AKAIRE_R2_BUCKET ?? "justquality-akaire-pdfs";
const DEV_EMAIL = process.env.AKAIRE_DEV_EMAIL ?? "kazu42@dev.local";

function usage() {
  console.log(`akaire CLI

Usage:
  akaire upload <pdf> <metadata.json> [--label="human-readable label"]
  akaire list-versions

Environment:
  AKAIRE_API         (default: ${API})
  AKAIRE_R2_BUCKET   (default: ${R2_BUCKET})
  AKAIRE_DEV_EMAIL   (default: ${DEV_EMAIL})
`);
}

function devHeaders() {
  return { "X-Dev-Email": DEV_EMAIL };
}

async function runWrangler(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["wrangler", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => (stdout += c.toString()));
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`wrangler exit ${code}\n${stderr}`));
    });
  });
}

async function uploadPdf(pdfPath, metadataPath, label) {
  const pdfBuf = readFileSync(pdfPath);
  const metaText = readFileSync(metadataPath, "utf-8");
  const meta = JSON.parse(metaText);

  if (!meta.version_id) {
    throw new Error("metadata.json に version_id がありません");
  }

  const r2Key = `pdfs/${meta.version_id}.pdf`;
  console.log(`PDF hash: ${sha256Short(pdfBuf)} (${(pdfBuf.length / 1024).toFixed(1)}KB)`);
  console.log(`version_id: ${meta.version_id}`);
  console.log(`r2_key:     ${r2Key}`);

  console.log("\n[1/2] R2 にアップロード…");
  await runWrangler([
    "r2",
    "object",
    "put",
    `${R2_BUCKET}/${r2Key}`,
    `--file=${pdfPath}`,
    "--content-type=application/pdf",
    "--remote",
  ]);
  console.log("  → OK");

  console.log("\n[2/2] API に version 登録…");
  const body = {
    id: meta.version_id,
    r2_key: r2Key,
    git_commit: meta.git_commit ?? null,
    built_at: new Date(meta.built_at ?? Date.now()).getTime(),
    page_count: meta.page_count,
    label: label ?? null,
    metadata_json: metaText,
  };
  const res = await fetch(`${API}/api/versions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...devHeaders(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  const created = await res.json();
  console.log("  → OK");
  console.log(`\nアップロード完了:`);
  console.log(`  ID:  ${created.id}`);
  console.log(`  URL: https://akaire-viewer.pages.dev/#/view/${encodeURIComponent(created.id)}`);
}

async function listVersions() {
  const res = await fetch(`${API}/api/versions`, { headers: devHeaders() });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  const { versions } = await res.json();
  if (versions.length === 0) {
    console.log("(versions は空)");
    return;
  }
  for (const v of versions) {
    const dt = new Date(v.built_at).toISOString();
    console.log(`${v.id}  (${v.page_count}p, ${dt}${v.label ? ", " + v.label : ""})`);
  }
}

function sha256Short(buf) {
  return createHash("sha256").update(buf).digest("hex").slice(0, 12);
}

function parseArgs(argv) {
  const args = [];
  const opts = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      opts[k] = v ?? true;
    } else {
      args.push(a);
    }
  }
  return { args, opts };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "-h" || cmd === "--help") {
    usage();
    process.exit(0);
  }
  const { args, opts } = parseArgs(rest);
  try {
    if (cmd === "upload") {
      if (args.length < 2) {
        console.error("usage: akaire upload <pdf> <metadata.json>");
        process.exit(2);
      }
      const [pdfPath, metadataPath] = args;
      statSync(pdfPath); // 存在確認
      statSync(metadataPath);
      await uploadPdf(pdfPath, metadataPath, opts.label ?? null);
    } else if (cmd === "list-versions" || cmd === "ls") {
      await listVersions();
    } else {
      usage();
      process.exit(2);
    }
  } catch (err) {
    console.error("error:", err?.message ?? err);
    process.exit(1);
  }
}

main();
