import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html", host: "localhost" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the create and join landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /HackMusic/);
  assert.match(html, /Let the room pick the vibe/);
  assert.match(html, /Create a room/);
  assert.match(html, /Join the room/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/);
});

test("renders a code-specific participant room", async () => {
  const response = await render("/e/ABC123");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Finding room[\s\S]*ABC123/);
  assert.match(html, /Join HackMusic room ABC123/);
  assert.doesNotMatch(html, /og\.png/);
  const source = await readFile(new URL("app/e/[code]/party-room.tsx", projectRoot), "utf8");
  assert.match(source, /CHEER/);
  assert.match(source, /BOO/);
  assert.match(source, /Add a song/);
  const partySource = await readFile(new URL("db/party.ts", projectRoot), "utf8");
  assert.match(partySource, /name: "Someone"/);
});

test("renders a code-specific host control surface", async () => {
  const response = await render("/e/ABC123/host");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Warming up room[\s\S]*ABC123/);
  assert.match(html, /Host HackMusic room ABC123/);
  assert.match(html, /noindex/);
  assert.doesNotMatch(html, /og\.png/);
  const source = await readFile(new URL("app/e/[code]/host/host-room.tsx", projectRoot), "utf8");
  assert.match(source, /HackMusic Host/);
  assert.match(source, /HOST CONTROL/);
  assert.match(source, /ROOM CODE/);
  assert.match(source, /QRCode/);
  assert.match(source, /Skip to next song/);
  assert.match(source, /LIVE SCOREBOARD/);
  assert.match(source, /End the party\?/);
  assert.match(source, /Nope, keep partying/);
  assert.match(source, /Yes, end it forever/);
  assert.match(source, /There is no undo/);
});

test("ships product metadata and removes starter artifacts", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /HackMusic — Let the room pick the vibe/);
  assert.match(html, /http:\/\/localhost\/og\.png/);
  assert.match(html, /favicon-32\.png/);
  assert.match(html, /apple-touch-icon\.png/);
  await access(new URL("public/og.png", projectRoot));
  await access(new URL("public/favicon.png", projectRoot));
  await access(new URL("public/favicon-32.png", projectRoot));
  await access(new URL("public/apple-touch-icon.png", projectRoot));
  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", projectRoot)));
  const packageJson = await readFile(new URL("package.json", projectRoot), "utf8");
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
