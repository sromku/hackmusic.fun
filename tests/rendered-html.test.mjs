import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const projectRoot = new URL("../", import.meta.url);

async function render(pathname = "/", requestHeaders = {}, bindings = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html", host: "localhost", ...requestHeaders } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, ...bindings },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function loadTypeScriptModule(pathname) {
  const source = await readFile(new URL(pathname, projectRoot), "utf8");
  let output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  if (output.includes('"./public-error"')) {
    const dependencySource = await readFile(new URL("lib/public-error.ts", projectRoot), "utf8");
    const dependencyOutput = ts.transpileModule(dependencySource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const dependencyUrl = `data:text/javascript;base64,${Buffer.from(dependencyOutput).toString("base64")}`;
    output = output.replace('"./public-error"', JSON.stringify(dependencyUrl));
  }
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

test("hashes room passcodes and compares them without storing plaintext", async () => {
  const passcodes = await loadTypeScriptModule("lib/room-passcode.ts");
  const passcodeSource = await readFile(new URL("lib/room-passcode.ts", projectRoot), "utf8");
  assert.match(passcodeSource, /iterations = 100_000/);
  assert.doesNotMatch(passcodeSource, /120_000/);
  const secured = await passcodes.hashRoomPasscode("vibe42");
  assert.notEqual(secured.hash, "VIBE42");
  assert.equal(await passcodes.verifyRoomPasscode("VIBE42", secured.hash, secured.salt), true);
  assert.equal(await passcodes.verifyRoomPasscode("WRONG1", secured.hash, secured.salt), false);
  assert.throws(() => passcodes.validateRoomPasscode("123"), /4–12/);
});

test("shows helpful product errors without leaking internal exceptions", async () => {
  const errors = await loadTypeScriptModule("lib/public-error.ts");
  assert.deepEqual(errors.publicErrorDetails(new errors.PublicError("Try the room code again.", 400), "Fallback"), { message: "Try the room code again.", status: 400 });
  assert.deepEqual(errors.publicErrorDetails(new Error("Pbkdf2 failed: internal runtime detail"), "Please try again."), { message: "Please try again.", status: 500 });
});

test("renders the create and join landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /HackMusic/);
  assert.match(html, /Let the room pick the vibe/);
  assert.match(html, /Create a room/);
  assert.match(html, /Join the room/);
  assert.match(html, />Join →<\/button>/);
  assert.doesNotMatch(html, /🚪 Join/);
  assert.match(html, /THREE MOVES\. MAXIMUM DRAMA/);
  assert.match(html, /Drop a secret song/);
  assert.match(html, /React out loud/);
  assert.match(html, /The crowd can skip/);
  assert.match(html, /SOME HUMANS · ONE SPEAKER/);
  assert.doesNotMatch(html, /6–30 HUMANS/);
  assert.match(html, /Scrambled by/);
  assert.match(html, /https:\/\/sromku\.com/);
  assert.match(html, /AGI unlocked\. Common sense still in beta/);
  assert.doesNotMatch(html, /SOTA unlocked/);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/terms"/);
  assert.match(html, /href="\/go-bigger"/);
  assert.match(html, /By creating or joining a room/);
  assert.match(html, /name="website"/);
  const landingSource = await readFile(new URL("app/page.tsx", projectRoot), "utf8");
  assert.match(landingSource, /Pre-party lobby/);
  assert.match(landingSource, /type="datetime-local"/);
  assert.match(landingSource, /preParty, scheduledFor/);
  assert.match(landingSource, /ROOM PASSCODE/);
  assert.match(landingSource, /joinPasscode/);
  assert.match(landingSource, /hackmusic:hostedRooms/);
  assert.match(landingSource, /Your hosted rooms/);
  assert.match(landingSource, /See all \{hostedRooms\.length\} rooms/);
  assert.match(landingSource, /hosted-history-sheet/);
  assert.match(landingSource, /role="dialog"/);
  assert.match(landingSource, /localStorage\.key\(index\)/);
  assert.match(landingSource, /hackmusic:\(\[A-Z0-9\]/);
  assert.match(landingSource, /Clear this browser’s site data/);
  assert.match(landingSource, /lede-play lede-room/);
  assert.match(landingSource, /lede-play lede-speaker/);
  assert.equal((landingSource.match(/className="rule-connector"/g) ?? []).length, 2);
  assert.doesNotMatch(landingSource, /next\/link/);
  const globalStyles = await readFile(new URL("app/globals.css", projectRoot), "utf8");
  assert.match(globalStyles, /\.landing-copy h1 \{[^}]*padding-bottom: \.12em;[^}]*margin-bottom: -\.12em;/);
  assert.match(globalStyles, /\.landing-hero \{[^}]*align-items: start;/);
  assert.match(globalStyles, /\.landing-copy \{ padding-top: clamp\(64px, 7vh, 84px\); \}/);
  assert.match(globalStyles, /@media \(max-width: 840px\)[\s\S]*\.landing-copy \{ padding-top: 0; \}/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/);
});

test("renders the commercial go bigger page with an email path", async () => {
  const response = await render("/go-bigger");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Go bigger/);
  assert.match(html, /Keep the chaos/);
  assert.match(html, /Restaurants &amp; bars/);
  assert.match(html, /Company events/);
  assert.match(html, /Venues &amp; conferences/);
  assert.match(html, /Custom chaos\. Sensibly invoiced/);
  assert.match(html, /bigger-word word-restaurant/);
  assert.match(html, /bigger-word word-gravity/);
  assert.match(html, /bigger-word word-room-app/);
  assert.match(html, /mailto:hackmusic\.fun@gmail\.com\?subject=HackMusic/);
  assert.match(html, /Event%20or%20venue/);
  assert.match(html, /href="\/"/);
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
  assert.match(privacy, /salted, one-way hashes/);
  assert.match(privacy, /encrypted, HTTP-only/);
  assert.match(privacy, /hosted-room shortcuts/);
  assert.match(privacy, /do not sell personal data/i);

  const termsResponse = await render("/terms");
  assert.equal(termsResponse.status, 200);
  const terms = await termsResponse.text();
  assert.match(terms, /Terms of Use/);
  assert.match(terms, /New Jersey law/);
  assert.match(terms, /public-performance license/);
  assert.match(terms, /OpenAI Sites/);
  assert.match(terms, /hackmusic\.fun@gmail\.com/);
  const legalSource = await readFile(new URL("app/legal-page.tsx", projectRoot), "utf8");
  assert.match(legalSource, /<a className="legal-home-link" href="\/">← Back to the party<\/a>/);
  assert.doesNotMatch(legalSource, /next\/link|<Link/);
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
  assert.match(source, /Vote locked for this song\. No take-backs/);
  assert.match(source, /disabled=\{busy \|\| Boolean\(myReaction\)\}/);
  assert.doesNotMatch(source, /tap to switch|Vote changed to Cheer|Changed your mind/);
  assert.match(source, /your-vote-badge/);
  assert.match(source, /Add to my Spotify/);
  assert.match(source, /MAX_PENDING_TRACKS_PER_PERSON - party\.pendingCount/);
  assert.match(source, /Played and skipped songs free their slots/);
  assert.match(source, /PRE-PARTY LOBBY/);
  assert.match(source, /The queue is undercover/);
  assert.match(source, /Reactions unlock when the host starts the party/);
  assert.match(source, /The room has spoken/);
  assert.match(source, /Final scores are frozen\. The music stopped; the bragging did not/);
  assert.match(source, /SPEAKER RETIRED/);
  assert.match(source, /LEFT UNPLAYED/);
  assert.match(source, /A remarkably peaceful party/);
  assert.match(source, /!ended && addOpen && party/);
  assert.match(source, /🎧 My music/);
  assert.match(source, /Still in my queue/);
  assert.match(source, /My played songs/);
  assert.match(source, /My reactions/);
  assert.match(source, /PRIVATE TO THIS BROWSER/);
  assert.match(source, /action: "remove", submissionId: song\.queueId/);
  assert.match(source, /Confirm removal of/);
  assert.match(source, /You booed anonymously/);
  assert.match(source, /ROOM PASSCODE/);
  assert.match(source, /x-hackmusic-participant/);
  assert.doesNotMatch(source, /participantId=\$\{encodeURIComponent/);
  assert.match(source, /art-variant-/);
  assert.doesNotMatch(source, /Playback lives on the host speaker/);
  assert.match(source, /ended && <span className="person-score"/);
  const partySource = await readFile(new URL("db/party.ts", projectRoot), "utf8");
  assert.match(partySource, /name: "Someone"/);
  assert.match(partySource, /revealScores = event\.status === "ended"/);
  assert.match(partySource, /score: revealScores \? person\.score : null/);
  assert.doesNotMatch(partySource, /UPDATE reactions SET kind/);
  assert.match(partySource, /createdAt: event\.created_at/);
  assert.match(partySource, /INSERT INTO reactions/);
  assert.match(partySource, /current\.artist === "Spotify"/);
  assert.match(partySource, /pending\?\.count \?\? 0\) >= MAX_PENDING_TRACKS_PER_PERSON/);
  assert.match(partySource, /event\.status === "lobby" \|\| event\.current_submission_id/);
  assert.match(partySource, /UPDATE events SET status = 'live'/);
  assert.match(partySource, /action: "start" \| "skip"/);
  assert.match(partySource, /verifyRoomPasscode/);
  assert.match(partySource, /id: person\.public_id/);
  assert.match(partySource, /mine: reaction\.participant_id === viewerId/);
  assert.match(partySource, /WHERE event_id = \? AND participant_id = \?/);
  assert.match(partySource, /WHERE r\.event_id = \? AND r\.participant_id = \?/);
  assert.match(partySource, /export async function removePendingTrack/);
  assert.match(partySource, /DELETE FROM submissions[\s\S]*participant_id = \? AND status = 'pending'/);
  assert.match(partySource, /That song is no longer waiting in your queue/);
  const partyRouteSource = await readFile(new URL("app/api/party/route.ts", projectRoot), "utf8");
  assert.match(partyRouteSource, /body\.action === "remove" && body\.submissionId/);
  assert.match(partyRouteSource, /protectPartyAction\(request, body\.action, code, participantId\)/);
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
  assert.match(partyRulesSource, /MAX_PARTICIPANTS_PER_ROOM = 100/);
  const securityMigration = await readFile(new URL("drizzle/0005_swift_manta.sql", projectRoot), "utf8");
  assert.match(securityMigration, /join_passcode_hash/);
  assert.match(securityMigration, /randomblob\(12\)/);
  assert.match(securityMigration, /participants_public_id_unique/);
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
  assert.doesNotMatch(robots, /admin|backstage-hm/i);
  assert.match(robots, /Sitemap: https:\/\/hackmusic\.fun\/sitemap\.xml/);

  const sitemapResponse = await render("/sitemap.xml");
  assert.equal(sitemapResponse.status, 200);
  const sitemap = await sitemapResponse.text();
  assert.match(sitemap, /<loc>https:\/\/hackmusic\.fun<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/hackmusic\.fun\/privacy<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/hackmusic\.fun\/terms<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/hackmusic\.fun\/go-bigger<\/loc>/);

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
  assert.match(source, /THE AUX CABLE HAS BEEN RETIRED/);
  assert.match(source, /CONTROLS FROZEN/);
  assert.match(source, /UNPLAYED AT CLOSING/);
  assert.match(source, /const partyEnded = partyStatus === "ended"/);
  assert.match(source, /if \(!participantId \|\| !hostKey \|\| partyEnded\) return/);
  assert.match(source, /\[code, getSpotifyToken, hostKey, participantId, partyEnded\]/);
  assert.match(source, /party\.status !== "ended" && <section className=\{`spotify-connect-card/);
  assert.match(source, /party\.status !== "ended" && endConfirmOpen/);
  assert.match(source, /🙌 CHEERS/);
  assert.match(source, /👻 BOOS/);
  assert.match(source, /x-hackmusic-host-key/);
  assert.doesNotMatch(source, /pin=\$\{encodeURIComponent\(hostKey\)\}/);
  assert.match(source, /JOIN PASSCODE/);
  assert.match(source, /\/sounds\/woohoo-crowd\.wav/);
  assert.match(source, /\/sounds\/boo\.mp3/);
  assert.match(source, /REACTION_SOUND_VERSION = "2026-08-23-4"/);
  assert.match(source, /activityAfter=\$\{encodeURIComponent\(soundActivityCursorRef\.current\)\}/);
  assert.match(source, /knownSoundActivityRef/);
  assert.match(source, /template\.cloneNode\(true\)/);
  assert.match(source, /activeReactionAudioRef/);
  assert.match(source, /REACTION_DUCK_VOLUME = 0\.16/);
  assert.match(source, /player\.getVolume\(\)/);
  assert.match(source, /player\.setVolume\(volume\)/);
  assert.match(source, /hostDevice === "ios"/);
  assert.match(source, /player\.resume\(\)/);
  assert.match(source, /Start speaker →/);
  assert.match(source, /Starts Spotify only\. Funny sounds stay off/);
  assert.match(source, /formatPlaybackTime/);
  assert.match(source, /setInterval\(updateProgress, 500\)/);
  assert.match(source, /host-playback-progress/);
  assert.match(source, /role="progressbar"/);
  assert.match(source, /action: "skipProgress"/);
  assert.match(source, /BOOED OFF AT/);
  assert.match(source, /SONG OUTCOMES/);
  assert.match(source, /READY TO START/);
  assert.match(source, /LOADING TRACK/);
  assert.match(source, /Disable funny sounds/);
  assert.match(source, /function disableAudio\(\)/);
  assert.doesNotMatch(source, /Start speaker \+ funny sounds/);
  assert.match(source, /wakeLock\.request\("screen"\)/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /Keep this screen awake/);
  assert.match(source, /detectHostDevice/);
  assert.match(source, /Screen-awake help · detected/);
  assert.match(source, /iPhone \/ iPad/);
  assert.match(source, /Developer options → Stay awake/);
  assert.match(source, /Computer/);
  assert.doesNotMatch(source, /Android auto-lock is blocked|stop Android from auto-locking/);
  assert.match(source, /PRE-PARTY LOBBY IS OPEN/);
  assert.match(source, /Start the party now/);
  assert.match(source, /Let the queue marinate/);
  assert.doesNotMatch(source, /speechSynthesis|SpeechSynthesisUtterance/);
  const hostStyles = await readFile(new URL("app/globals.css", projectRoot), "utf8");
  assert.match(hostStyles, /\.host-grid \{[^}]*align-items: start/);
  assert.match(hostStyles, /\.host-reaction-counts > div \{[^}]*align-items: center;[^}]*min-height: 82px/);
  assert.match(hostStyles, /\.host-progress-track \{[^}]*height: 16px/);
  assert.match(hostStyles, /\.host-progress-track > span \{[^}]*transition: width \.45s linear/);
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
  assert.match(partySource, /collapseLegacyReactionActivity/);
  assert.match(partySource, /reaction is already locked for this song/);
  assert.doesNotMatch(partySource, /UPDATE reactions SET kind/);
  assert.match(partySource, /tone: "song"/);
  assert.match(partySource, /skip_reason = 'boos'/);
  assert.match(partySource, /export async function recordBooSkipProgress/);
  assert.match(partySource, /skipPercent: track\.skip_percent/);
  const historyMigration = await readFile(new URL("drizzle/0002_eager_mole_man.sql", projectRoot), "utf8");
  assert.match(historyMigration, /CREATE TABLE `activity_events`/);
  assert.match(historyMigration, /legacy-reaction-/);
  const skipStatsMigration = await readFile(new URL("drizzle/0006_omniscient_onslaught.sql", projectRoot), "utf8");
  assert.match(skipStatsMigration, /ADD `skip_reason` text/);
  assert.match(skipStatsMigration, /ADD `skip_percent` integer/);
  const spotifyLoginSource = await readFile(new URL("app/api/spotify/login/route.ts", projectRoot), "utf8");
  assert.match(spotifyLoginSource, /code_challenge_method: "S256"/);
  assert.match(spotifyLoginSource, /"streaming"/);
  const spotifyCallbackSource = await readFile(new URL("app/api/spotify/callback/route.ts", projectRoot), "utf8");
  assert.match(spotifyCallbackSource, /grant_type: "authorization_code"/);
  assert.match(spotifyCallbackSource, /SPOTIFY_SESSION_COOKIE/);
  const spotifyAuthSource = await readFile(new URL("lib/spotify-auth.ts", projectRoot), "utf8");
  assert.match(spotifyAuthSource, /AES-GCM/);
  assert.match(spotifyAuthSource, /SPOTIFY_COOKIE_SECRET/);
  const participantSource = await readFile(new URL("app/e/[code]/party-room.tsx", projectRoot), "utf8");
  assert.match(participantSource, /Booed off at/);
  assert.match(participantSource, /Checking Spotify/);
  assert.match(participantSource, /Add to the secret queue/);
});

test("detects the host device used for wake-lock guidance", async () => {
  const devices = await loadTypeScriptModule("lib/host-device.ts");
  assert.equal(devices.detectHostDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "ios");
  assert.equal(devices.detectHostDevice("Mozilla/5.0 (Linux; Android 15; Pixel 9)"), "android");
  assert.equal(devices.detectHostDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "computer");
  assert.equal(devices.detectHostDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5), "ios");
});

test("starts Spotify PKCE without exposing a client secret", async () => {
  const clientId = "1234567890abcdef1234567890abcdef";
  process.env.SPOTIFY_COOKIE_SECRET = "test-only-cookie-encryption-secret-32-bytes";
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
  delete process.env.SPOTIFY_COOKIE_SECRET;
});

test("adds API and private-route security headers", async () => {
  const response = await render("/e/ABC123");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
  const partyRoute = await readFile(new URL("app/api/party/route.ts", projectRoot), "utf8");
  assert.match(partyRoute, /readBoundedJson/);
  assert.match(partyRoute, /protectPartyAction/);
  assert.match(partyRoute, /assertPartyParticipant/);
});

test("protects the hosted read-only admin with ChatGPT identity and an owner allowlist", async () => {
  const routeSource = await readFile(new URL("app/api/backstage-retired-slug/route.ts", projectRoot), "utf8");
  assert.match(routeSource, /getChatGPTUser/);
  assert.match(routeSource, /adminAccessForEmail/);
  assert.doesNotMatch(routeSource, /authorization|ADMIN_API_KEY|Bearer/);
  assert.match(routeSource, /no-store, private/);
  assert.match(routeSource, /x-robots-tag/);
  const authSource = await readFile(new URL("app/admin-auth.ts", projectRoot), "utf8");
  assert.match(authSource, /ADMIN_ALLOWED_EMAILS/);
  assert.match(authSource, /adminAllowlistAccess/);
  const allowlist = await loadTypeScriptModule("lib/admin-allowlist.ts");
  assert.deepEqual(allowlist.adminAllowlistAccess(" OWNER@Example.com ", "other@example.com, owner@example.COM"), { configured: true, allowed: true });
  assert.deepEqual(allowlist.adminAllowlistAccess("stranger@example.com", "owner@example.com"), { configured: true, allowed: false });
  assert.deepEqual(allowlist.adminAllowlistAccess("owner@example.com", ""), { configured: false, allowed: false });
  const pageSource = await readFile(new URL("app/backstage-retired-slug/page.tsx", projectRoot), "utf8");
  assert.match(pageSource, /requireChatGPTUser\("\/backstage-retired-slug"\)/);
  assert.match(pageSource, /OWNER ACCESS ONLY/);
  assert.match(pageSource, /robots: \{ index: false/);
  const dashboardSource = await readFile(new URL("app/backstage-retired-slug/admin-dashboard.tsx", projectRoot), "utf8");
  assert.match(dashboardSource, /Owner only\. Read only/);
  assert.match(dashboardSource, /\/api\/backstage-retired-slug/);
  assert.match(dashboardSource, /No host keys/);
  const adminSource = await readFile(new URL("db/admin.ts", projectRoot), "utf8");
  assert.doesNotMatch(adminSource, /host_pin/);
  assert.match(adminSource, /Anonymous boo/);
  await assert.rejects(access(new URL("tools/admin/server.mjs", projectRoot)));
  await assert.rejects(access(new URL("app/admin/page.tsx", projectRoot)));
  await assert.rejects(access(new URL("app/api/admin/route.ts", projectRoot)));

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
  await access(new URL("public/sounds/woohoo-crowd.wav", projectRoot));
  await access(new URL("public/sounds/boo.mp3", projectRoot));
  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", projectRoot)));
  const packageJson = await readFile(new URL("package.json", projectRoot), "utf8");
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
