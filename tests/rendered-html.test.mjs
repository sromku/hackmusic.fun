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
  const embedState = { props: { pageProps: { state: { data: { entity: { id: "5lf9LK4eETye6DsPUJpHDB", title: "Zombie - Afro House", duration: 483903, artists: [{ name: "Afrynthe Vora" }] } } } } } };
  assert.deepEqual(spotify.parseSpotifyEmbedMetadata(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(embedState)}</script>`, "5lf9LK4eETye6DsPUJpHDB"), {
    title: "Zombie - Afro House",
    artists: ["Afrynthe Vora"],
    durationMs: 483903,
  });
});

test("renders the create and join landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /HackMusic/);
  assert.match(html, /Let the room pick the vibe/);
  assert.match(html, /Create a room/);
  assert.match(html, /Join the room/);
  assert.match(html, /THREE MOVES\. MAXIMUM DRAMA/);
  assert.match(html, /Drop a secret song/);
  assert.match(html, /React out loud/);
  assert.match(html, /The crowd can skip/);
  assert.match(html, /Chaos-ed by/);
  assert.match(html, /https:\/\/sromku\.com/);
  assert.match(html, /Common sense still in beta/);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/terms"/);
  assert.match(html, /By creating or joining a room/);
  assert.match(html, /name="website"/);
  const landingSource = await readFile(new URL("app/page.tsx", projectRoot), "utf8");
  assert.match(landingSource, /Pre-party lobby/);
  assert.match(landingSource, /type="datetime-local"/);
  assert.match(landingSource, /preParty, scheduledFor/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/);
});

test("renders tailored privacy and terms pages", async () => {
  const privacyResponse = await render("/privacy");
  assert.equal(privacyResponse.status, 200);
  const privacy = await privacyResponse.text();
  assert.match(privacy, /Privacy Policy/);
  assert.match(privacy, /Necessary means necessary/);
  assert.match(privacy, /hackmusic\.fun@gmail\.com/);
  assert.match(privacy, /New Jersey/);
  assert.match(privacy, /Spotify session cookie/);
  assert.match(privacy, /do not sell personal data/i);

  const termsResponse = await render("/terms");
  assert.equal(termsResponse.status, 200);
  const terms = await termsResponse.text();
  assert.match(terms, /Terms of Use/);
  assert.match(terms, /New Jersey law/);
  assert.match(terms, /public-performance license/);
  assert.match(terms, /OpenAI Sites/);
  assert.match(terms, /hackmusic\.fun@gmail\.com/);
});

test("renders a code-specific participant room", async () => {
  const response = await render("/e/ABC123");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Finding room[\s\S]*ABC123/);
  assert.match(html, /Join HackMusic room ABC123/);
  assert.match(html, /noindex/);
  assert.doesNotMatch(html, /og(?:-v2)?\.png/);
  const source = await readFile(new URL("app/e/[code]/party-room.tsx", projectRoot), "utf8");
  assert.match(source, /CHEER/);
  assert.match(source, /BOO/);
  assert.match(source, /Add a song/);
  assert.match(source, /YOUR FINAL SCORE/);
  assert.match(source, /Now playing:/);
  assert.match(source, /song-start/);
  assert.match(source, /🔊 ROOM NOISE/);
  assert.match(source, /FULL PARTY HISTORY/);
  assert.match(source, /activityAfter=/);
  assert.match(source, /Scrollable history of songs and reactions since the party began/);
  assert.match(source, /Scroll inside Room Noise/);
  assert.match(source, /item\.tone === "up" \? "🎉" : "👻"/);
  assert.match(source, /🦗 It’s suspiciously quiet/);
  assert.match(source, /Changed your mind\? Tap the other reaction/);
  assert.match(source, /Vote changed to Cheer/);
  assert.match(source, /your-vote-badge/);
  assert.match(source, /Add to my Spotify/);
  assert.match(source, /MAX_PENDING_TRACKS_PER_PERSON - party\.pendingCount/);
  assert.match(source, /Played and skipped songs free their slots/);
  assert.match(source, /PRE-PARTY LOBBY/);
  assert.match(source, /The queue is undercover/);
  assert.match(source, /Reactions unlock when the host starts the party/);
  assert.match(source, /art-variant-/);
  assert.doesNotMatch(source, /Playback lives on the host speaker/);
  assert.match(source, /ended && <span className="person-score"/);
  const partySource = await readFile(new URL("db/party.ts", projectRoot), "utf8");
  assert.match(partySource, /name: "Someone"/);
  assert.match(partySource, /revealScores = event\.status === "ended"/);
  assert.match(partySource, /score: revealScores \? person\.score : null/);
  assert.match(partySource, /UPDATE reactions SET kind/);
  assert.match(partySource, /newEffect - oldEffect/);
  assert.match(partySource, /current\.artist === "Spotify"/);
  assert.match(partySource, /pending\?\.count \?\? 0\) >= MAX_PENDING_TRACKS_PER_PERSON/);
  assert.match(partySource, /event\.status === "lobby" \|\| event\.current_submission_id/);
  assert.match(partySource, /UPDATE events SET status = 'live'/);
  assert.match(partySource, /action: "start" \| "skip"/);
  const lobbyMigration = await readFile(new URL("drizzle/0004_lean_kronos.sql", projectRoot), "utf8");
  assert.match(lobbyMigration, /ADD `scheduled_for` text/);
  const roomGuardSource = await readFile(new URL("lib/room-creation-guard.ts", projectRoot), "utf8");
  assert.match(roomGuardSource, /maximum: 5/);
  assert.match(roomGuardSource, /maximum: 20/);
  assert.match(roomGuardSource, /SHA-256/);
  assert.match(roomGuardSource, /DELETE FROM room_creation_limits WHERE expires_at/);
  const roomGuardMigration = await readFile(new URL("drizzle/0003_slow_norrin_radd.sql", projectRoot), "utf8");
  assert.match(roomGuardMigration, /CREATE TABLE `room_creation_limits`/);
  assert.match(roomGuardMigration, /room_creation_limits_expires_idx/);
  const partyRulesSource = await readFile(new URL("lib/party-rules.ts", projectRoot), "utf8");
  assert.match(partyRulesSource, /MAX_PENDING_TRACKS_PER_PERSON = 100/);
});

test("publishes crawler, sitemap, and install metadata without exposing private rooms", async () => {
  const robotsResponse = await render("/robots.txt");
  assert.equal(robotsResponse.status, 200);
  const robots = await robotsResponse.text();
  assert.match(robots, /User-Agent: \*/);
  assert.match(robots, /Allow: \//);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Disallow: \/e\//);
  assert.match(robots, /Disallow: \/host/);
  assert.match(robots, /Sitemap: https:\/\/hackmusic\.fun\/sitemap\.xml/);

  const sitemapResponse = await render("/sitemap.xml");
  assert.equal(sitemapResponse.status, 200);
  const sitemap = await sitemapResponse.text();
  assert.match(sitemap, /<loc>https:\/\/hackmusic\.fun<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/hackmusic\.fun\/privacy<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/hackmusic\.fun\/terms<\/loc>/);

  const manifestResponse = await render("/manifest.webmanifest");
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.name, "HackMusic — Multiplayer Music Party Game");
  assert.equal(manifest.start_url, "/");
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
  assert.match(source, /WAITING IN THE QUEUE/);
  assert.match(source, /party\.queuedTracks\.map/);
  assert.match(source, /Submitted order/);
  assert.match(source, /Pure chaos/);
  assert.match(source, /Fair-ish shuffle/);
  assert.match(source, /action: "queueMode"/);
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
  assert.match(source, /wakeLock\.request\("screen"\)/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /Keep this screen awake/);
  assert.match(source, /Android auto-lock is blocked/);
  assert.match(source, /PRE-PARTY LOBBY IS OPEN/);
  assert.match(source, /Start the party now/);
  assert.match(source, /Let the queue marinate/);
  assert.doesNotMatch(source, /speechSynthesis|SpeechSynthesisUtterance/);
  const partySource = await readFile(new URL("db/party.ts", projectRoot), "utf8");
  assert.match(partySource, /const queuedTracks = isHost/);
  assert.match(partySource, /s\.status = 'pending'/);
  assert.match(partySource, /queuedTracks: queuedTracks\.results\.map/);
  assert.match(partySource, /event\.queue_mode === "random"/);
  assert.match(partySource, /event\.queue_mode === "fair"/);
  assert.match(partySource, /history\.served_count ASC, RANDOM\(\)/);
  assert.match(partySource, /export async function setQueueMode/);
  assert.match(partySource, /INSERT INTO activity_events/);
  assert.match(partySource, /activityAfter !== undefined/);
  assert.match(partySource, /tone: "song"/);
  const historyMigration = await readFile(new URL("drizzle/0002_eager_mole_man.sql", projectRoot), "utf8");
  assert.match(historyMigration, /CREATE TABLE `activity_events`/);
  assert.match(historyMigration, /legacy-reaction-/);
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

test("keeps database administration secret, local, and read only", async () => {
  const routeSource = await readFile(new URL("app/api/admin/route.ts", projectRoot), "utf8");
  assert.match(routeSource, /authorization/);
  assert.match(routeSource, /no-store, private/);
  assert.match(routeSource, /x-robots-tag/);
  const adminSource = await readFile(new URL("db/admin.ts", projectRoot), "utf8");
  assert.doesNotMatch(adminSource, /host_pin/);
  assert.match(adminSource, /Anonymous boo/);
  const localServer = await readFile(new URL("tools/admin/server.mjs", projectRoot), "utf8");
  assert.match(localServer, /server\.listen\(port, "127\.0\.0\.1"/);
  assert.match(localServer, /authorization: `Bearer \$\{adminKey\}`/);
  await access(new URL("tools/admin/index.html", projectRoot));
  await access(new URL("tools/admin/admin.css", projectRoot));
  await access(new URL("tools/admin/admin.js", projectRoot));
});

test("ships product metadata and removes starter artifacts", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /HackMusic — Let the room pick the vibe/);
  assert.match(html, /http:\/\/localhost\/og-v2\.png/);
  assert.match(html, /https:\/\/hackmusic\.fun/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /Multiplayer music game|Secret song submissions/);
  assert.match(html, /favicon-32\.png/);
  assert.match(html, /apple-touch-icon\.png/);
  await access(new URL("public/og-v2.png", projectRoot));
  await access(new URL("public/llms.txt", projectRoot));
  await access(new URL("public/llms-full.txt", projectRoot));
  await access(new URL("public/favicon.png", projectRoot));
  await access(new URL("public/favicon-32.png", projectRoot));
  await access(new URL("public/favicon.ico", projectRoot));
  await access(new URL("public/apple-touch-icon.png", projectRoot));
  await access(new URL("public/sounds/cheer.wav", projectRoot));
  await access(new URL("public/sounds/boo.wav", projectRoot));
  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", projectRoot)));
  const packageJson = await readFile(new URL("package.json", projectRoot), "utf8");
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
