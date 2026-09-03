import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { renderPage as render } from "./support/worker.mjs";

const projectRoot = new URL("../", import.meta.url);

const transpiledModuleUrls = new Map();

async function transpileTypeScriptModule(pathname) {
  if (transpiledModuleUrls.has(pathname)) return transpiledModuleUrls.get(pathname);
  const source = await readFile(new URL(pathname, projectRoot), "utf8");
  let output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const directory = pathname.slice(0, pathname.lastIndexOf("/") + 1);
  for (const match of [...output.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)]) {
    const dependencyPath = new URL(`${match[1]}.ts`, `file:///${directory}`).pathname.slice(1);
    output = output.replace(`"${match[1]}"`, JSON.stringify(await transpileTypeScriptModule(dependencyPath)));
  }
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
  transpiledModuleUrls.set(pathname, moduleUrl);
  return moduleUrl;
}

async function loadTypeScriptModule(pathname) {
  return import(await transpileTypeScriptModule(pathname));
}

test("normalizes Spotify share links and short links to their actual track token", async () => {
  const spotify = await loadTypeScriptModule("lib/spotify-track.ts");
  const sharedUrl = "https://open.spotify.com/track/5lf9LK4eETye6DsPUJpHDB?si=_RP727UlSjaJQ9Br-CjVng&utm_source=copy-link&rowId=96b58bf6ac48b9f48565&context=spotify%3Aplaylist%3A37i9dQZF1F5p3rmiWPIYgZ";
  assert.deepEqual(spotify.parseSpotifyTrackReference(sharedUrl), {
    trackId: "5lf9LK4eETye6DsPUJpHDB",
    uri: "spotify:track:5lf9LK4eETye6DsPUJpHDB",
    canonicalUrl: "https://open.spotify.com/track/5lf9LK4eETye6DsPUJpHDB",
  });
  assert.equal(spotify.extractSpotifyTrackId(`link-${sharedUrl}`), "5lf9LK4eETye6DsPUJpHDB");
  const shortUrl = "https://open.spotify.com/s/TLUsRqX";
  const shortResolved = await spotify.resolveSpotifyTrackReference(shortUrl, async (requestUrl) => {
    assert.match(String(requestUrl), /^https:\/\/open\.spotify\.com\/oembed\?url=/);
    return new Response(
      JSON.stringify({ iframe_url: "https://open.spotify.com/embed/track/1fh4rarBaLB8l5ALt1UvPv?utm_source=oembed" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  assert.deepEqual(shortResolved, {
    trackId: "1fh4rarBaLB8l5ALt1UvPv",
    uri: "spotify:track:1fh4rarBaLB8l5ALt1UvPv",
    canonicalUrl: "https://open.spotify.com/track/1fh4rarBaLB8l5ALt1UvPv",
  });
  await assert.rejects(
    () => spotify.resolveSpotifyTrackReference(
      "https://open.spotify.com/s/not-a-track",
      async () => new Response(JSON.stringify({ iframe_url: "https://open.spotify.com/embed/playlist/37i9dQZF1F5p3rmiWPIYgZ" }), { status: 200 }),
    ),
    /does not point to a playable track/,
  );
  assert.throws(() => spotify.parseSpotifyTrackReference("https://open.spotify.com/playlist/37i9dQZF1F5p3rmiWPIYgZ"), /track token/);
  const embedState = { props: { pageProps: { state: { data: { entity: { id: "5lf9LK4eETye6DsPUJpHDB", title: "Zombie - Afro House", duration: 483903, artists: [{ name: "Afrynthe Vora" }] } } } } } };
  assert.deepEqual(spotify.parseSpotifyEmbedMetadata(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(embedState)}</script>`, "5lf9LK4eETye6DsPUJpHDB"), {
    title: "Zombie - Afro House",
    artists: ["Afrynthe Vora"],
    durationMs: 483903,
  });
});

test("normalizes YouTube share links and resolves video metadata without a Google API key", async () => {
  const youtube = await loadTypeScriptModule("lib/youtube-track.ts");
  for (const link of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2&t=43s",
    "https://youtu.be/dQw4w9WgXcQ?si=abc123",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ&feature=share",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "youtube:video:dQw4w9WgXcQ",
  ]) {
    assert.deepEqual(youtube.parseYouTubeVideoReference(link), {
      videoId: "dQw4w9WgXcQ",
      uri: "youtube:video:dQw4w9WgXcQ",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    }, link);
  }
  assert.throws(() => youtube.parseYouTubeVideoReference("https://www.youtube.com/playlist?list=PL123"), /valid YouTube video ID/);
  assert.throws(() => youtube.parseYouTubeVideoReference("https://vimeo.com/12345"), /youtube\.com or youtu\.be/);
  assert.equal(youtube.extractYouTubeVideoId("prefix youtube:video:dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(youtube.extractYouTubeVideoId("spotify:track:5lf9LK4eETye6DsPUJpHDB"), "");
  assert.equal(youtube.cleanYouTubeTitle("Rick Astley - Never Gonna Give You Up (Official Music Video) [HD]"), "Rick Astley - Never Gonna Give You Up");
  assert.equal(youtube.cleanYouTubeChannel("RickAstleyVEVO"), "RickAstley");
  assert.equal(youtube.cleanYouTubeChannel("Rick Astley - Topic"), "Rick Astley");
  assert.deepEqual(youtube.parseYouTubeWatchMetadata('<html>{"videoDetails":{"lengthSeconds":"213","isLiveContent":false}}</html>'), { durationSeconds: 213, isLive: false });
  assert.deepEqual(youtube.parseYouTubeWatchMetadata('<meta itemprop="duration" content="PT3M33S">'), { durationSeconds: 213, isLive: false });

  const requests = [];
  const resolved = await youtube.resolveYouTubeTrack("https://youtu.be/dQw4w9WgXcQ", async (requestUrl) => {
    requests.push(String(requestUrl));
    if (String(requestUrl).includes("/oembed")) {
      return new Response(JSON.stringify({ title: "Rick Astley - Never Gonna Give You Up (Official Video)", author_name: "RickAstleyVEVO" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response('<html>"lengthSeconds":"213"</html>', { status: 200 });
  });
  assert.deepEqual(resolved, {
    id: "youtube:video:dQw4w9WgXcQ",
    videoId: "dQw4w9WgXcQ",
    canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Rick Astley - Never Gonna Give You Up",
    artist: "RickAstley",
    duration: "3:33",
    color: "coral",
  });
  assert.ok(requests.some((url) => url.startsWith("https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ")));
  await assert.rejects(() => youtube.resolveYouTubeTrack("https://youtu.be/dQw4w9WgXcQ", async (requestUrl) => new Response(String(requestUrl).includes("/oembed") ? "Unauthorized" : "", { status: 401 })), /private or cannot be embedded/);
  await assert.rejects(() => youtube.resolveYouTubeTrack("https://youtu.be/dQw4w9WgXcQ", async (requestUrl) => new Response(String(requestUrl).includes("/oembed") ? "Not Found" : "", { status: 404 })), /could not find that video/);

  const links = await loadTypeScriptModule("lib/track-link.ts");
  assert.equal(links.trackSource("https://open.spotify.com/track/5lf9LK4eETye6DsPUJpHDB?si=x"), "spotify");
  assert.equal(links.trackSource("https://youtu.be/dQw4w9WgXcQ"), "youtube");
  assert.equal(links.trackSource("youtube:video:dQw4w9WgXcQ"), "youtube");
  assert.equal(links.trackSource("https://soundcloud.com/some/track"), null);
  assert.deepEqual(links.parseTrackReference("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), { source: "youtube", uri: "youtube:video:dQw4w9WgXcQ", canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  assert.deepEqual(links.parseTrackReference("spotify:track:5lf9LK4eETye6DsPUJpHDB"), { source: "spotify", uri: "spotify:track:5lf9LK4eETye6DsPUJpHDB", canonicalUrl: "https://open.spotify.com/track/5lf9LK4eETye6DsPUJpHDB" });
  assert.throws(() => links.parseTrackReference("https://soundcloud.com/some/track"), /Spotify track link or a YouTube video link/);
  assert.equal(links.trackWebUrl("youtube:video:dQw4w9WgXcQ"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(links.trackWebUrl("spotify:track:5lf9LK4eETye6DsPUJpHDB"), "https://open.spotify.com/track/5lf9LK4eETye6DsPUJpHDB");
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

test("accepts only the curated party-face emoji collection", async () => {
  const avatars = await loadTypeScriptModule("lib/avatar-emojis.ts");
  assert.equal(avatars.AVATAR_EMOJIS.length, 24);
  assert.equal(avatars.isAvatarEmoji("🪩"), true);
  assert.equal(avatars.isAvatarEmoji("not-an-emoji"), false);
});

test("formats song durations, Spotify links, and outcomes consistently", async () => {
  const format = await loadTypeScriptModule("lib/party-format.ts");
  assert.equal(format.durationSeconds("4:09"), 249);
  assert.equal(format.durationSeconds("4:9"), 0);
  assert.equal(format.formatMusicDuration(59), "Under 1 min");
  assert.equal(format.formatMusicDuration(3_725), "1 hr 2 min");
  assert.equal(format.formatPlaybackTime(-500), "0:00");
  assert.equal(format.formatPlaybackTime(125_999), "2:05");
  assert.equal(format.spotifyTrackWebUrl("spotify:track:5lf9LK4eETye6DsPUJpHDB"), "https://open.spotify.com/track/5lf9LK4eETye6DsPUJpHDB");
  assert.equal(format.spotifyTrackWebUrl("youtube:video:abc"), "");
  assert.equal(format.trackWebUrl("youtube:video:dQw4w9WgXcQ"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(format.trackWebUrl("spotify:track:5lf9LK4eETye6DsPUJpHDB"), "https://open.spotify.com/track/5lf9LK4eETye6DsPUJpHDB");
  assert.equal(format.trackSourceLabel("youtube:video:dQw4w9WgXcQ"), "YouTube");
  assert.equal(format.trackSourceLabel("spotify:track:5lf9LK4eETye6DsPUJpHDB"), "Spotify");
  assert.equal(format.mySongStatusLabel({ status: "skipped", skipReason: "boos", skipPercent: 42 }, false), "👻 Booed off at 42%");
  assert.deepEqual(format.hostSongOutcome({ status: "skipped", skipReason: "host", skipPercent: null }), { label: "⏭️ SKIPPED BY HOST", tone: "host" });
  assert.deepEqual(format.hostSongOutcome({ status: "skipped", skipReason: "boos", skipPercent: 42 }), { label: "🪦 BOOED OFF AT 42%", tone: "boos" });
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
  assert.match(landingSource, /WHERE DOES THE MUSIC COME FROM\?/);
  assert.match(landingSource, /passcode: roomPasscode, musicSource, preParty/);
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
  assert.equal((landingSource.match(/aria-haspopup="dialog"/g) ?? []).length, 3);
  assert.match(landingSource, /HACKMUSIC FIELD MANUAL/);
  assert.match(landingSource, /ADD A SONG\. TELL NOBODY/);
  assert.match(landingSource, /CHEER IT\. BOO IT\. COMMIT/);
  assert.match(landingSource, /THIRD BOO PULLS THE PLUG/);
  assert.match(landingSource, /One human\. One vote per song/);
  assert.match(landingSource, /Final scores unlock at the end/);
  assert.match(landingSource, /ArrowRight/);
  assert.match(landingSource, /aria-modal="true"/);
  assert.doesNotMatch(landingSource, /next\/link/);
  const globalStyles = await readFile(new URL("app/globals.css", projectRoot), "utf8");
  assert.match(globalStyles, /\.landing-copy h1 \{[^}]*padding-bottom: \.12em;[^}]*margin-bottom: -\.12em;/);
  assert.match(globalStyles, /\.landing-hero \{[^}]*align-items: start;/);
  assert.match(globalStyles, /\.landing-copy \{ padding-top: clamp\(64px, 7vh, 84px\); \}/);
  assert.match(globalStyles, /@media \(max-width: 840px\)[\s\S]*\.landing-copy \{ padding-top: 0; \}/);
  assert.match(globalStyles, /\.rule-connector::before \{[^}]*width: 3px;[^}]*background: var\(--ink\);/);
  assert.match(globalStyles, /\.rule-connector::after \{[^}]*width: 9px;[^}]*background: var\(--mint\);/);
  assert.doesNotMatch(globalStyles, /\.rule-connector::after \{ content: "↓";/);
  assert.match(globalStyles, /\.party-lesson-backdrop \{[^}]*position: fixed;[^}]*z-index: 100;/);
  assert.match(globalStyles, /\.party-lesson-copy h2 \{[^}]*font-size: clamp\(66px, 10vw, 152px\);/);
  assert.match(globalStyles, /@media \(max-width: 560px\)[\s\S]*\.party-lesson-backdrop \{ align-items: end;/);
  assert.match(globalStyles, /\.party-lesson \{ width: 100%; height: auto;[^}]*max-height: 90dvh;/);
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
  assert.match(html, /TABLE QR CODES/);
  assert.match(html, /BIG-SCREEN MODE/);
  assert.match(html, /RUN-OF-SHOW FIT/);
  assert.equal((html.match(/class="bigger-card-perks"/g) ?? []).length, 3);
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
  assert.match(privacy, /cookie-free, first-party website analytics/i);
  assert.match(privacy, /raw IP addresses/);
  assert.match(privacy, /older than 90 days/);
  assert.match(privacy, /Global Privacy Control/);
  assert.match(privacy, /YouTube \(Google\)/);
  assert.match(privacy, /Last updated September 3, 2026/);

  const termsResponse = await render("/terms");
  assert.equal(termsResponse.status, 200);
  const terms = await termsResponse.text();
  assert.match(terms, /Terms of Use/);
  assert.match(terms, /New Jersey law/);
  assert.match(terms, /public-performance license/);
  assert.match(terms, /YouTube Terms of Service/);
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
  for (const copy of ["CHEER", "BOO", "Add a song", "YOUR FINAL SCORE", "🔊 ROOM NOISE", "FULL PARTY HISTORY", "🎧 My music", "Pick your party face", "Rename your human", "YOUR PARTY NAME", "YOUR NAME — SHOWN TO EVERYONE", "This is how other humans will see you. It is not the room code.", "ROOM PASSCODE — ASK THE HOST", "Paste a full track or short /s/ link…", "Paste a YouTube video link…", "YOUTUBE VIDEO LINK", "This room plays YouTube only", "Open on YouTube", "Show me how", "Borrow the link. Keep the chaos.", "Copy link", "I found the link"]) {
    assert.match(source, new RegExp(copy));
  }
  for (const fun of ["Who picked this one?", "flair-bar", "Shield my song", "Arm my double cheer", "MYSTERY SOLVED", "PARTY AWARDS", "Share the recap card", "ROUND THEME", "flyaway-layer", "navigator.vibrate"]) {
    assert.match(source, new RegExp(fun.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), fun);
  }
  assert.match(source, /action: "flair"/);
  assert.match(source, /action: "shield"/);
  assert.match(source, /action: "guess"/);
  assert.match(source, /spotifyHelpOpen/);
  assert.match(source, /aria-labelledby="spotify-help-title"/);
  assert.match(source, /event\.key === "Escape"/);
  const globalStyles = await readFile(new URL("app/globals.css", projectRoot), "utf8");
  assert.match(globalStyles, /\.spotify-help-steps \{[^}]*grid-template-columns: repeat\(3,/);
  assert.match(globalStyles, /@media \(max-width: 820px\)[\s\S]*\.spotify-help-card \{[^}]*width: 100%;[^}]*max-height: 94dvh;/);
  assert.match(globalStyles, /@media \(max-width: 820px\)[\s\S]*\.spotify-help-steps \{ grid-template-columns: 1fr;/);
  assert.ok(source.indexOf("🔊 ROOM NOISE") < source.indexOf("🎧 My music"));
  assert.match(source, /import type \{[\s\S]*ParticipantParty[\s\S]*\} from "\.\.\/\.\.\/\.\.\/lib\/party-contract"/);
  assert.match(source, /formatMusicDuration/);
  assert.match(source, /action: "remove"/);
  assert.match(source, /action: "avatar"/);
  assert.match(source, /action: "profileName"/);
  assert.match(source, /viewerDisplayName/);
  assert.match(source, /Boolean\(myReaction\)/);
  assert.match(source, /const hasPlayedSong = .*item\.tone === "song"/);
  assert.match(source, /The last song left the chat/);
  assert.match(source, /Add another secret song and keep the speaker employed/);
  assert.match(source, /Add another song →/);
  assert.match(source, /x-hackmusic-participant/);
  assert.doesNotMatch(source, /participantId=\$\{encodeURIComponent/);
  const participantStyles = await readFile(new URL("app/globals.css", projectRoot), "utf8");
  assert.match(participantStyles, /\.party-name-trigger/);
  assert.match(participantStyles, /\.name-picker-card/);
  assert.match(participantStyles, /\.my-track-list \{[^}]*overscroll-behavior-y: auto/);
  assert.match(participantStyles, /\.activity-list \{[^}]*overscroll-behavior-y: auto/);
  const partyRulesSource = await readFile(new URL("lib/party-rules.ts", projectRoot), "utf8");
  assert.match(partyRulesSource, /MAX_PENDING_TRACKS_PER_PERSON = 100/);
  assert.match(partyRulesSource, /MAX_PARTICIPANTS_PER_ROOM = 100/);
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
  assert.match(robots, /Disallow: \/lab\//);
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
  assert.match(source, /YOUTUBE VIDEO SPEAKER/);
  assert.match(source, /useYouTubePlayer/);
  assert.match(source, /className=\{`youtube-stage/);
  assert.match(source, /trackSource\(track\.id\) === "youtube"/);
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
  assert.match(source, /REFRESH ROOM DATA/);
  assert.match(source, /Safe refresh · music keeps playing/);
  assert.match(source, /Spotify kept playing without interruption/);
  assert.match(source, /setInterval\(\(\) => \{ void refreshParty\(\); \}, 2000\)/);
  assert.match(source, /setSyncProblem\("HackMusic briefly lost the party service/);
  assert.match(source, /beforeunload/);
  assert.match(source, /event\.returnValue = ""/);
  assert.match(source, /error && !party/);
  assert.match(source, /Open participant page safely/);
  assert.doesNotMatch(source, /catch\(\(reason\) => \{ if \(active\) setError/);
  assert.doesNotMatch(source, /className="host-message"/);
  assert.match(source, /THE AUX CABLE HAS BEEN RETIRED/);
  assert.match(source, /CONTROLS FROZEN/);
  assert.match(source, /UNPLAYED AT CLOSING/);
  assert.match(source, /const partyEnded = partyStatus === "ended"/);
  assert.match(source, /if \(!participantId \|\| !hostKey \|\| partyEnded \|\| !spotifyRoom\) return/);
  assert.match(source, /\[code, getSpotifyToken, hostKey, participantId, partyEnded, spotifyRoom\]/);
  assert.match(source, /party\.status !== "ended" && spotifyRoom && <section id="spotify-connect" className=\{`spotify-connect-card/);
  assert.match(source, /party\.status !== "ended" && youtubeRoom && <section className="spotify-connect-card youtube-room-card"/);
  assert.match(source, /enabled: hostReady && youtubeRoom/);
  assert.match(source, /party\.status !== "ended" && endConfirmOpen/);
  assert.match(source, /🙌 CHEERS/);
  assert.match(source, /👻 BOOS/);
  assert.match(source, /x-hackmusic-host-key/);
  assert.doesNotMatch(source, /pin=\$\{encodeURIComponent\(hostKey\)\}/);
  assert.match(source, /JOIN PASSCODE/);
  assert.match(source, /activityAfter=\$\{encodeURIComponent\(soundActivityCursorRef\.current\)\}/);
  assert.match(source, /knownSoundActivityRef/);
  assert.match(source, /useReactionSounds/);
  assert.match(source, /useScreenWakeLock/);
  assert.match(source, /Start speaker →/);
  assert.match(source, /Speaker armed\. Enjoy the dramatic silence/);
  assert.match(source, /for \(let attempt = 1; attempt <= 4/);
  assert.match(source, /It will wake the speaker and start automatically/);
  assert.doesNotMatch(source, /party\?\.status === "ended" \|\| !currentSpotifyId/);
  assert.match(source, /Starts Spotify only\. Funny sounds stay off/);
  assert.match(source, /formatPlaybackTime/);
  assert.match(source, /setInterval\(updateProgress, 500\)/);
  assert.match(source, /host-playback-progress/);
  assert.match(source, /role="progressbar"/);
  assert.match(source, /action: "skipProgress"/);
  assert.match(source, /SONG OUTCOMES/);
  assert.match(source, /READY TO START/);
  assert.match(source, /LOADING TRACK/);
  assert.match(source, /Disable funny sounds/);
  assert.match(source, /function disableAudio\(\)/);
  assert.doesNotMatch(source, /Start speaker \+ funny sounds/);
  assert.match(source, /Keep this screen awake/);
  assert.match(source, /detectHostDevice/);
  assert.match(source, /Screen-awake help · detected/);
  assert.match(source, /iPhone \/ iPad/);
  assert.match(source, /Developer options → Stay awake/);
  assert.match(source, /Computer/);
  assert.doesNotMatch(source, /Android auto-lock is blocked|stop Android from auto-locking/);
  assert.match(source, /Rare host moves/);
  assert.match(source, /SETUP ORDER · TOP TO BOTTOM/);
  assert.match(source, /const currentStepIndex = setupSteps\.findIndex\(\(step\) => !step\.done\)/);
  assert.match(source, /state === "locked" \|\| step\.disabled/);
  assert.match(source, /Setup complete\. Music is playing on this device/);
  assert.match(source, /id="spotify-connect"/);
  assert.match(source, /<HostEffects bursts=\{bursts\}/);
  assert.match(source, /📯 Airhorn/);
  assert.match(source, /action: "theme"/);
  assert.match(source, /ONE MORE BOO/);
  assert.match(source, /PLUG PULLED/);
  assert.match(source, /THREE CHEERS IN A ROW/);
  assert.match(source, /NEW LEADER/);
  assert.match(source, /PARTY AWARDS/);
  assert.match(source, /shareRecapCard/);
  const effectsSource = await readFile(new URL("app/e/[code]/host/host-effects.tsx", projectRoot), "utf8");
  assert.match(effectsSource, /host-blackout/);
  assert.match(effectsSource, /burst-\$\{burst\.kind\}/);
  assert.match(source, /useReadinessCheck/);
  assert.match(source, /readiness check/);
  assert.match(source, /host-readiness-card/);
  assert.match(source, /aria-labelledby="host-readiness-title"/);
  const readinessSource = await readFile(new URL("app/e/[code]/host/use-readiness-check.ts", projectRoot), "utf8");
  assert.match(readinessSource, /detectHostBrowser/);
  assert.match(readinessSource, /LATER_PLAYBACK_DELAY_MS/);
  assert.match(readinessSource, /wakeLock|requestScreenWakeLock/);
  assert.match(readinessSource, /probeRoomData/);
  assert.match(readinessSource, /visibilityState/);
  assert.match(source, /Rename event/);
  assert.match(source, /action: "rename"/);
  assert.match(source, /Rename the chaos/);
  assert.match(source, /Only the name changes/);
  assert.match(source, /Pass the aux cable/);
  assert.match(source, /HIGHLY CONTROLLED MUTINY/);
  assert.match(source, /action: "prepareHostTransfer"/);
  assert.match(source, /action: "cancelHostTransfer"/);
  assert.match(source, /action: "claimHost"/);
  assert.match(source, /#handoff=/);
  assert.match(source, /window\.localStorage\.setItem\(`hackmusic:\$\{code\}:host`/);
  assert.match(source, /window\.localStorage\.removeItem\(`hackmusic:\$\{code\}:host`/);
  assert.match(source, /Spotify cannot teleport/);
  assert.match(source, /PRE-PARTY LOBBY IS OPEN/);
  assert.match(source, /Start the party now/);
  assert.match(source, /Let the queue marinate/);
  assert.doesNotMatch(source, /speechSynthesis|SpeechSynthesisUtterance/);
  const reactionSoundSource = await readFile(new URL("app/e/[code]/host/use-reaction-sounds.ts", projectRoot), "utf8");
  assert.match(reactionSoundSource, /\/sounds\/woohoo-crowd\.wav/);
  assert.match(reactionSoundSource, /\/sounds\/boo\.mp3/);
  assert.match(reactionSoundSource, /REACTION_DUCK_VOLUME = 0\.28/);
  assert.match(reactionSoundSource, /decodeAudioData/);
  assert.match(reactionSoundSource, /player\.setVolume/);
  assert.match(reactionSoundSource, /ensureContextRunning/);
  assert.match(reactionSoundSource, /"airhorn"/);
  assert.match(reactionSoundSource, /playEffect/);
  assert.match(reactionSoundSource, /playbackRate/);
  assert.match(reactionSoundSource, /audioSession/);
  assert.match(reactionSoundSource, /playThroughElement/);
  assert.doesNotMatch(reactionSoundSource, /context\.state === "suspended"/);
  const youtubeSdkSource = await readFile(new URL("app/e/[code]/host/youtube-sdk.ts", projectRoot), "utf8");
  assert.match(youtubeSdkSource, /https:\/\/www\.youtube\.com\/iframe_api/);
  const youtubePlayerSource = await readFile(new URL("app/e/[code]/host/use-youtube-player.ts", projectRoot), "utf8");
  assert.match(youtubePlayerSource, /loadVideoById/);
  assert.match(youtubePlayerSource, /playsinline: 1/);
  assert.match(youtubePlayerSource, /YouTubePlayerState\.ended/);
  const wakeLockSource = await readFile(new URL("app/e/[code]/host/use-screen-wake-lock.ts", projectRoot), "utf8");
  assert.match(wakeLockSource, /wakeLock\.request\("screen"\)/);
  assert.match(wakeLockSource, /visibilitychange/);
  const hostStyles = await readFile(new URL("app/globals.css", projectRoot), "utf8");
  assert.match(hostStyles, /\.host-grid \{[^}]*align-items: start/);
  assert.match(hostStyles, /\.host-reaction-counts > div \{[^}]*align-items: center;[^}]*min-height: 82px/);
  assert.match(hostStyles, /\.host-progress-track \{[^}]*height: 16px/);
  assert.match(hostStyles, /\.host-progress-track > span \{[^}]*transition: width \.45s linear/);
  const queueSource = await readFile(new URL("db/party-queue.ts", projectRoot), "utf8");
  assert.match(queueSource, /event\.queue_mode === "random"/);
  assert.match(queueSource, /event\.queue_mode === "fair"/);
  assert.match(queueSource, /served_count ASC, RANDOM\(\)/);
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
  assert.match(participantSource, /Checking the link/);
  assert.match(participantSource, /Add to the secret queue/);
  assert.match(participantSource, /trackWebUrl/);
  assert.doesNotMatch(participantSource, /spotifyTrackWebUrl/);
});

test("detects the host device used for wake-lock guidance", async () => {
  const devices = await loadTypeScriptModule("lib/host-device.ts");
  assert.equal(devices.detectHostDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "ios");
  assert.equal(devices.detectHostDevice("Mozilla/5.0 (Linux; Android 15; Pixel 9)"), "android");
  assert.equal(devices.detectHostDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "computer");
  assert.equal(devices.detectHostDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5), "ios");
  assert.equal(devices.detectHostBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1", "MacIntel", 5), "ipad-chrome");
  assert.equal(devices.detectHostBrowser("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"), "ios-safari");
  assert.equal(devices.detectHostBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/128.0 Mobile/15E148 Safari/604.1"), "ios-other");
  assert.equal(devices.detectHostBrowser("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36"), "android-chrome");
  assert.equal(devices.detectHostBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0 Safari/537.36"), "desktop");
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
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'self'/);
  const labResponse = await render("/lab/ABC123");
  assert.equal(labResponse.status, 200);
  assert.match(labResponse.headers.get("x-robots-tag") ?? "", /noindex/);
  const labHtml = await labResponse.text();
  assert.match(labHtml, /HackMusic Test Lab/);
  assert.match(labHtml, /Room <strong>ABC123<\/strong>/);
  const labSource = await readFile(new URL("app/lab/[code]/lab-room.tsx", projectRoot), "utf8");
  assert.match(labSource, /persona=guest-\$\{index\}/);
  assert.match(labSource, /participantStorageKey/);
  const storage = await loadTypeScriptModule("lib/party-storage.ts");
  assert.equal(storage.participantStorageKey("ABC123"), "hackmusic:ABC123:participant");
  assert.equal(storage.participantStorageKey("ABC123", "guest-2"), "hackmusic:ABC123:participant:guest-2");
  assert.equal(storage.participantStorageKey("ABC123", "../evil key!"), "hackmusic:ABC123:participant:evilkey");
  assert.equal(storage.personaFromSearch("?persona=guest-3&passcode=VIBE42"), "guest-3");
  assert.equal(storage.personaDisplayName("guest-3"), "Guest 3");
  const participantSource = await readFile(new URL("app/e/[code]/party-room.tsx", projectRoot), "utf8");
  assert.match(participantSource, /isDevelopmentHost\(window\.location\.hostname\) \? personaFromSearch\(window\.location\.search\) : ""/);
  const devOnly = await loadTypeScriptModule("lib/dev-only.ts");
  for (const host of ["localhost", "app.localhost", "127.0.0.1", "10.0.0.5", "192.168.1.20", "172.20.3.4", "169.254.1.1", "::1", "[::1]", "roman-macbook.local"]) assert.equal(devOnly.isDevelopmentHost(host), true, host);
  for (const host of ["hackmusic.fun", "www.hackmusic.fun", "172.32.0.1", "11.0.0.1", "192.169.1.1", "localhost.evil.com", ""]) assert.equal(devOnly.isDevelopmentHost(host), false, host);
  // Production hosts: no lab page, no framing.
  const { requestWorker } = await import("./support/worker.mjs");
  const productionLab = await requestWorker("https://hackmusic.fun/lab/ABC123");
  assert.equal(productionLab.status, 404);
  assert.equal(productionLab.headers.get("x-frame-options"), "DENY");
  const productionRoom = await requestWorker("https://hackmusic.fun/e/ABC123");
  assert.equal(productionRoom.status, 200);
  assert.equal(productionRoom.headers.get("x-frame-options"), "DENY");
  assert.match(productionRoom.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
  const partyRoute = await readFile(new URL("app/api/party/route.ts", projectRoot), "utf8");
  assert.match(partyRoute, /readBoundedJson/);
  assert.match(partyRoute, /executePartyAction/);
  const partyActions = await readFile(new URL("app/api/party/party-actions.ts", projectRoot), "utf8");
  assert.match(partyActions, /protectPartyAction/);
  assert.match(partyActions, /assertPartyParticipant/);
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
  const adminLayoutSource = await readFile(new URL("app/backstage-retired-slug/layout.tsx", projectRoot), "utf8");
  assert.match(adminLayoutSource, /\/admin-favicon\.svg\?v=admin-hm-red-2/);
  assert.match(adminLayoutSource, /<AdminFavicon \/>/);
  const adminFaviconSource = await readFile(new URL("app/backstage-retired-slug/admin-favicon.tsx", projectRoot), "utf8");
  assert.match(adminFaviconSource, /link\[rel~="icon"\]/);
  assert.match(adminFaviconSource, /MutationObserver/);
  assert.match(adminFaviconSource, /hackmusicAdminIcon/);
  const rootLayoutSource = await readFile(new URL("app/layout.tsx", projectRoot), "utf8");
  assert.match(rootLayoutSource, /icons: \{/);
  assert.doesNotMatch(rootLayoutSource, /<link rel="icon"/);
  const adminFaviconSvg = await readFile(new URL("public/admin-favicon.svg", projectRoot), "utf8");
  assert.match(adminFaviconSvg, /#FF5B51/);
  assert.match(adminFaviconSvg, /#FFF9ED/);
  const dashboardSource = await readFile(new URL("app/backstage-retired-slug/admin-dashboard.tsx", projectRoot), "utf8");
  assert.match(dashboardSource, /Owner only\. Read only/);
  assert.match(dashboardSource, /\/api\/backstage-retired-slug/);
  assert.match(dashboardSource, /Room inspection hides host keys/);
  assert.match(dashboardSource, /Website traffic/);
  assert.match(dashboardSource, /Site pulse/);
  assert.match(dashboardSource, /Daily party activity/);
  assert.match(dashboardSource, /Active rooms/);
  assert.match(dashboardSource, /Songs started/);
  assert.match(dashboardSource, /Day by day/);
  assert.match(dashboardSource, /Top pages/);
  assert.match(dashboardSource, /No raw IPs, room codes, query strings/);
  assert.match(dashboardSource, /Disaster recovery/);
  assert.match(dashboardSource, /Download encrypted backup/);
  assert.match(dashboardSource, /encryptBackupSnapshot/);
  const backupRouteSource = await readFile(new URL("app/api/backstage-retired-slug/backup/route.ts", projectRoot), "utf8");
  assert.match(backupRouteSource, /getChatGPTUser/);
  assert.match(backupRouteSource, /adminAccessForEmail/);
  assert.match(backupRouteSource, /readPortableBackup/);
  assert.match(backupRouteSource, /assertSameOriginMutation/);
  assert.match(backupRouteSource, /consumeRequestLimit/);
  assert.match(backupRouteSource, /subject: user\.userId/);
  assert.match(backupRouteSource, /maximum: 3/);
  assert.match(backupRouteSource, /no-store, private/);
  const adminSource = await readFile(new URL("db/admin.ts", projectRoot), "utf8");
  assert.doesNotMatch(adminSource, /host_pin/);
  assert.match(adminSource, /Anonymous boo/);
  assert.match(adminSource, /date\('now', '-29 days'\)/);
  assert.match(adminSource, /kind = 'song_start'/);
  assert.match(adminSource, /COUNT\(DISTINCT event_id\) AS active_rooms/);
  await assert.rejects(access(new URL("tools/admin/server.mjs", projectRoot)));
  await assert.rejects(access(new URL("app/admin/page.tsx", projectRoot)));
  await assert.rejects(access(new URL("app/api/admin/route.ts", projectRoot)));

});

test("collects privacy-preserving first-party website analytics", async () => {
  const layoutSource = await readFile(new URL("app/layout.tsx", projectRoot), "utf8");
  assert.match(layoutSource, /AnalyticsTracker/);

  const trackerSource = await readFile(new URL("app/analytics-tracker.tsx", projectRoot), "utf8");
  assert.match(trackerSource, /sessionStorage/);
  assert.match(trackerSource, /navigator\.doNotTrack/);
  assert.match(trackerSource, /globalPrivacyControl/);
  assert.match(trackerSource, /credentials: "omit"/);
  assert.match(trackerSource, /pathname\.startsWith\("\/backstage-"\)/);

  const routeSource = await readFile(new URL("app/api/analytics/route.ts", projectRoot), "utf8");
  assert.match(routeSource, /assertSameOriginMutation/);
  assert.match(routeSource, /readBoundedJson/);
  assert.match(routeSource, /recordPageview/);

  const analyticsSource = await readFile(new URL("db/analytics.ts", projectRoot), "utf8");
  assert.match(analyticsSource, /\/e\/:room/);
  assert.match(analyticsSource, /SHA-256/);
  assert.match(analyticsSource, /RETENTION_DAYS = 90/);
  assert.match(analyticsSource, /DELETE FROM analytics_pageviews/);
  assert.doesNotMatch(analyticsSource, /cf-connecting-ip|x-forwarded-for|x-real-ip/);

  const migration = await readFile(new URL("drizzle/0007_nasty_iron_man.sql", projectRoot), "utf8");
  assert.match(migration, /CREATE TABLE `analytics_pageviews`/);
  assert.match(migration, /analytics_pageviews_day_visit_idx/);
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
  await assert.rejects(access(new URL("public/sounds/boo.wav", projectRoot)));
  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", projectRoot)));
  const packageJson = await readFile(new URL("package.json", projectRoot), "utf8");
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
