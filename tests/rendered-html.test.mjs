import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

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

async function loadTypeScriptModule(pathname) {
  const source = await readFile(new URL(pathname, projectRoot), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("normalizes Spotify share links to their actual track token", async () => {
  const spotify = await loadTypeScriptModule("lib/spotify-track.ts");
  const sharedUrl = "https://open.spotify.com/track/5lf9LK4eETye6DsPUJpHDB?si=_RP727UlSjaJQ9Br-CjVng&utm_source=copy-link&rowId=96b58bf6ac48b9f48565&context=spotify%3Aplaylist%3A37i9dQZF1F5p3rmiWPIYgZ";
  assert.deepEqual(spotify.parseSpotifyTrackReference(sharedUrl), {
    trackId: "5lf9LK4eETye6DsPUJpHDB",
    uri: "spotify:track:5lf9LK4eETye6DsPUJpHDB",
    canonicalUrl: "https://open.spotify.com/track/5lf9LK4eETye6DsPUJpHDB",
  });
  assert.equal(spotify.extractSpotifyTrackId(`link-${sharedUrl}`), "5lf9LK4eETye6DsPUJpHDB");
  assert.throws(() => spotify.parseSpotifyTrackReference("https://open.spotify.com/playlist/37i9dQZF1F5p3rmiWPIYgZ"), /track token/);
});

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
  assert.match(source, /YOUR FINAL SCORE/);
  assert.match(source, /Now playing:/);
  assert.match(source, /song-start/);
  assert.match(source, /🔊 ROOM NOISE/);
  assert.match(source, /reaction\.tone === "up" \? "🎉" : "👻"/);
  assert.match(source, /🦗 It’s suspiciously quiet/);
  assert.match(source, /ended && <span className="person-score"/);
  const partySource = await readFile(new URL("db/party.ts", projectRoot), "utf8");
  assert.match(partySource, /name: "Someone"/);
  assert.match(partySource, /revealScores = event\.status === "ended"/);
  assert.match(partySource, /score: revealScores \? person\.score : null/);
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
  assert.match(source, /SPOTIFY PREMIUM SPEAKER/);
  assert.match(source, /https:\/\/sdk\.scdn\.co\/spotify-player\.js/);
  assert.match(source, /Connect Spotify Premium/);
  assert.match(source, /\/api\/spotify\/callback/);
  assert.match(source, /activateElement/);
  assert.doesNotMatch(source, /open\.spotify\.com\/embed\/track/);
  assert.match(source, /Skip to next song/);
  assert.match(source, /LIVE SCOREBOARD/);
  assert.match(source, /End the party\?/);
  assert.match(source, /Nope, keep partying/);
  assert.match(source, /Yes, end it forever/);
  assert.match(source, /There is no undo/);
  assert.match(source, /className="toast host-toast"/);
  assert.doesNotMatch(source, /className="host-message"/);
  assert.match(source, /🙌 CHEERS/);
  assert.match(source, /👻 BOOS/);
  assert.match(source, /pin=\$\{encodeURIComponent\(hostKey\)\}/);
  assert.match(source, /\/sounds\/cheer\.wav/);
  assert.match(source, /\/sounds\/boo\.wav/);
  assert.doesNotMatch(source, /speechSynthesis|SpeechSynthesisUtterance/);
  const spotifyLoginSource = await readFile(new URL("app/api/spotify/login/route.ts", projectRoot), "utf8");
  assert.match(spotifyLoginSource, /code_challenge_method: "S256"/);
  assert.match(spotifyLoginSource, /"streaming"/);
  const spotifyCallbackSource = await readFile(new URL("app/api/spotify/callback/route.ts", projectRoot), "utf8");
  assert.match(spotifyCallbackSource, /grant_type: "authorization_code"/);
  assert.match(spotifyCallbackSource, /SPOTIFY_SESSION_COOKIE/);
  const participantSource = await readFile(new URL("app/e/[code]/party-room.tsx", projectRoot), "utf8");
  assert.match(participantSource, /Checking Spotify/);
  assert.match(participantSource, /Add to the secret queue/);
});

test("starts Spotify PKCE without exposing a client secret", async () => {
  const clientId = "1234567890abcdef1234567890abcdef";
  const response = await render(`/api/spotify/login?clientId=${clientId}&roomCode=ABC123`);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.origin, "https://accounts.spotify.com");
  assert.equal(location.pathname, "/authorize");
  assert.equal(location.searchParams.get("client_id"), clientId);
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.match(location.searchParams.get("scope"), /streaming/);
  assert.equal(location.searchParams.get("redirect_uri"), "http://localhost/api/spotify/callback");
  assert.match(response.headers.get("set-cookie"), /hackmusic_spotify_oauth=/);
  assert.doesNotMatch(location.toString(), /client_secret/);

  const tokenResponse = await render("/api/spotify/token");
  assert.equal(tokenResponse.status, 401);
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
  await access(new URL("public/sounds/cheer.wav", projectRoot));
  await access(new URL("public/sounds/boo.wav", projectRoot));
  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", projectRoot)));
  const packageJson = await readFile(new URL("package.json", projectRoot), "utf8");
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
