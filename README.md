# HackMusic

HackMusic turns one speaker and a room full of opinions into a private music party game. Guests secretly queue Spotify tracks or YouTube videos, the host device plays them (YouTube needs no account; Spotify tracks need a connected Spotify Premium account), and each person gets one cheer or anonymous boo per song. Three boos skip the track; scores are revealed when the party ends.

The production site is [hackmusic.fun](https://hackmusic.fun).

## Local development

Requirements: Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run lint
npm test
npm run build
```

`npm test` builds the real worker before running tests. This catches routing and bundling failures as well as domain behavior.

## Architecture

The code follows a thin-route, explicit-domain-boundary shape:

- `app/` contains pages, client components, and HTTP route shells.
- `app/api/party/route.ts` owns HTTP parsing and response/error translation only.
- `app/api/party/party-actions.ts` validates and dispatches party commands.
- `db/party.ts` owns party use cases and persistence orchestration.
- `db/party-model.ts` owns database row models and shared normalization/load helpers.
- `db/party-queue.ts` owns ordered, random, and fair-ish queue selection.
- `lib/party-contract.ts` is the shared API/UI contract source of truth.
- `lib/party-format.ts` contains pure display and duration helpers.
- `lib/track-link.ts` detects the music source of a pasted link and dispatches to `lib/spotify-track.ts` or `lib/youtube-track.ts`.
- `app/e/[code]/host/use-reaction-sounds.ts` owns reaction audio mixing and music volume ducking for whichever player is active.
- `app/e/[code]/host/use-youtube-player.ts` owns the YouTube IFrame player lifecycle on the host page.
- `app/e/[code]/host/use-screen-wake-lock.ts` owns screen wake-lock lifecycle behavior.
- `app/e/[code]/host/spotify-sdk.ts` and `app/e/[code]/host/youtube-sdk.ts` isolate the third-party SDK surfaces.

Keep platform concerns at the edges. UI components should consume shared contracts rather than re-declaring response shapes, API routes should delegate domain work, and queue policy should not leak into rendering code.

## Important product invariants

These rules are enforced on the server, not merely hidden in the UI:

- A host key is required for host-only controls.
- A room passcode is required to join.
- A room accepts at most 100 participants.
- A participant may keep at most 100 pending songs.
- A room plays one music source, Spotify or YouTube, chosen at creation; links from the other service are rejected.
- A track may appear only once in an event.
- A participant gets one immutable reaction per played song.
- A participant cannot react to their own song.
- Boo identities are never revealed to participants or the admin dashboard.
- Scores stay hidden until the event is ended.
- Three distinct boos skip the current song.

## Testing approach

`tests/party-api-flow.test.mjs` sends requests through the built worker and uses an in-memory SQLite-backed D1 adapter. It verifies complete flows and state transitions: protected joins, score visibility, reaction locking, owner-vote rejection, boo anonymity, three-boo advancement, skip statistics, room ending, malformed/cross-origin writes, and participant capacity.

`tests/rendered-html.test.mjs` covers public/private route metadata, legal pages, Spotify PKCE, admin protection, essential UI affordances, and pure formatting/security helpers. Source assertions are intentionally limited to architecture or platform integration seams that cannot be exercised in Node.

When adding a feature, prefer one meaningful flow or edge-case test over implementation-specific line matching.

## Testing a party from one browser

Every tab in one browser profile normally shares the same guest identity. For multi-guest testing without a pile of phones, open `/lab/CODE` (development hosts only: localhost, private LAN addresses, and `.local` names; production returns 404 and ignores personas) for a room you created in that browser. It shows the host page plus up to eight guest frames, each joined as its own persona (`/e/CODE?persona=guest-2`), with the passcode pre-filled. Personas only change where the browser stores each guest's id; the server applies the passcode, membership, and one-vote rules exactly as it does for real phones. Click inside the host frame once so the browser allows audio and video there.

## Data and secrets

Cloudflare D1 is exposed to the worker as the `DB` binding declared in `.openai/hosting.json`. Spotify and admin secrets belong in hosted secrets or ignored local environment files. Never commit client secrets, session encryption keys, host keys, passcodes, production database exports, or `.env*` files other than `.env.example`.

The read-only owner dashboard lives at its intentionally unlinked backstage route. It requires ChatGPT sign-in and an email present in `ADMIN_ALLOWED_EMAILS`. The room browser never returns host keys or boo identities. Its explicit backup action does include recovery-critical host keys and hashed passcodes, then encrypts the snapshot in the owner’s browser before download.

## Manual encrypted backups

The owner dashboard’s **Disaster recovery** panel downloads a complete, versioned database snapshot. It contains durable rooms, participants, submissions, reactions, activity history, and privacy-preserving analytics; temporary room-creation rate-limit rows are intentionally excluded.

The passphrase never leaves the browser. The download uses PBKDF2-SHA-256 and AES-256-GCM, carries a plaintext SHA-256 integrity value, and contains no readable database data outside its ciphertext. Keep the file and passphrase in separate secure places. There is intentionally no password recovery mechanism.

To verify and decrypt an export locally with Node.js 22 or newer:

```bash
npm run backup:decrypt -- /path/to/hackmusic-backup.hackmusic-backup
```

The script prompts without echoing the passphrase, verifies authenticated encryption and the integrity digest, refuses to overwrite an existing output, and writes the recovered JSON with owner-only filesystem permissions. Decryption is a recovery/inspection tool; importing that JSON into another database will be added as a separate, deliberate restore workflow.

## Deployment

OpenAI Sites deployment uses short-lived credentials supplied by Codex; no deployment token is written to the repository.

```bash
npm run deploy:prepare
```

The release preparation script requires a clean worktree, runs tests and lint, scans Git history with Gitleaks, and creates an ignored archive under `outputs/sites/`.
