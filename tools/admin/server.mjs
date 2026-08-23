import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const adminDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(adminDir, "../..");

function parseEnv(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return [];
    const index = trimmed.indexOf("=");
    return [[trimmed.slice(0, index).trim(), trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")]];
  }));
}

let fileEnv = {};
try {
  fileEnv = parseEnv(await readFile(path.join(projectDir, ".env.admin"), "utf8"));
} catch {
  // Environment variables can be supplied directly when the local file is absent.
}

const adminKey = process.env.HACKMUSIC_ADMIN_KEY ?? fileEnv.HACKMUSIC_ADMIN_KEY;
const remoteOrigin = process.env.HACKMUSIC_ADMIN_ORIGIN ?? fileEnv.HACKMUSIC_ADMIN_ORIGIN ?? "https://hackmusic.fun";
const port = Number(process.env.HACKMUSIC_ADMIN_PORT ?? fileEnv.HACKMUSIC_ADMIN_PORT ?? "4177");

if (!adminKey || adminKey === "replace-with-the-hosted-admin-key") {
  console.error("Missing HACKMUSIC_ADMIN_KEY. Add it to .env.admin before starting the dashboard.");
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error("HACKMUSIC_ADMIN_PORT must be an available port from 1024 to 65535.");
  process.exit(1);
}

const assets = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/admin.js", { file: "admin.js", type: "text/javascript; charset=utf-8" }],
  ["/admin.css", { file: "admin.css", type: "text/css; charset=utf-8" }],
]);

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (request.method !== "GET") {
    response.writeHead(405, { allow: "GET" }).end("Method not allowed");
    return;
  }

  if (url.pathname === "/api/data") {
    const upstream = new URL("/api/admin", remoteOrigin);
    upstream.search = url.search;
    try {
      const result = await fetch(upstream, {
        headers: { authorization: `Bearer ${adminKey}`, accept: "application/json" },
        redirect: "error",
      });
      response.writeHead(result.status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, private",
        "x-content-type-options": "nosniff",
      });
      response.end(await result.text());
    } catch {
      response.writeHead(502, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ error: "Could not reach HackMusic. Check your connection and try again." }));
    }
    return;
  }

  const asset = assets.get(url.pathname);
  if (!asset) {
    response.writeHead(404).end("Not found");
    return;
  }
  const body = await readFile(path.join(adminDir, asset.file));
  response.writeHead(200, {
    "content-type": asset.type,
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'none'; object-src 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`HackMusic Admin is ready at http://127.0.0.1:${port}`);
  console.log("It is available only on this computer. Press Control-C to stop it.");
});
