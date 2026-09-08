# 🎉 HackMusic

**Let the room pick the vibe.**

One speaker. A crowd with opinions. Guests secretly queue songs, everyone cheers or boos, and three boos pull the plug. Scores stay hidden until the party ends. No app, no accounts for guests, no playlist dictators.

🌐 Live at **[hackmusic.fun](https://hackmusic.fun)**

---

## 🎮 How a party works

1. **Host creates a room.** Pick Spotify or YouTube, set a passcode, share the six-character code.
2. **Guests join from their phones.** Paste a song link. Nobody sees what is coming next.
3. **The speaker plays.** Every song is a mystery until it drops.
4. **React out loud.** One reaction per song per person. Cheers are public. Boos are anonymous.
5. **The crowd can skip.** Three boos and the next secret song starts.
6. **End the party.** Scores are revealed, boos are unmasked, awards are handed out.

### The scoreboard

| Move | Points |
| --- | --- |
| Everyone starts with | 30 |
| Your song gets a cheer | +3 |
| Your song gets a boo | −3 |
| Guess the mystery DJ correctly | +2 |
| Your song gets a **boosted** cheer | +6 |

### Power-ups and extras

- 🛡️ **Shield.** One per party. Your song needs four boos to skip instead of three.
- 🚀 **Boost.** One per party. Your next cheer is worth double.
- 🕵️ **Guess the DJ.** Who queued this? Guess right while it plays for bonus points.
- 🔥 **Flair.** Throw emoji at the host screen while the song plays.
- 🎨 **Theme.** The host names the night and everyone plays along.
- 🏆 **Awards.** Crowd Pleaser, Most Booed, Fastest Skip, Marathon Pick, Silent Judge, Sharpest Guesser.
- 🖼️ **Hall of Fame.** An end-of-party recap page and shareable story image.

### Two flavors of room

| | Spotify room | YouTube room |
| --- | --- | --- |
| Host needs | Spotify Premium | Nothing |
| Guests need | Nothing | Nothing |
| Plays | Full tracks through the host device | Videos on the host screen |
| Guests paste | Spotify track links | YouTube video links, Shorts, youtu.be |

The source is locked when the room is created. Links from the other service are politely declined. Spotify hosts bring their own Spotify app Client ID and sign in with PKCE, so no Spotify secret exists anywhere in this project.

## 🖥️ The screens

- **Home.** Create a room, join with a code, or reopen rooms this browser has hosted.
- **Host screen.** Playback, queue, queue strategy (submitted order, random, or a fair-ish shuffle), reaction sounds, theme, skip, and end party.
- **Guest phone.** Submit songs, cheer, boo, guess, throw flair, and watch the noise feed.
- **Pre-party lobby.** Collect songs before the event. Only the host starts the music.
- **Recap.** Final scores, unmasked boos, awards, and the story image.
- **Lab.** A development-only page that shows the host plus up to eight fake guests in one browser, for testing without a pile of phones.

## 🛠️ Run it locally

Requires Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env.local   # fill in the values
npm run dev
```

| Variable | Purpose |
| --- | --- |
| `SPOTIFY_COOKIE_SECRET` | 32+ random characters used to encrypt the host's Spotify session cookie |
| `ADMIN_ALLOWED_EMAILS` | Comma-separated emails allowed into the owner dashboard |
| `ADMIN_SECRET_PATH` | Random slug (16+ chars) that becomes the owner dashboard URL, `/backstage/<slug>`. Unset means no dashboard. |

Checks:

```bash
npm run lint
npm test        # builds the real worker, then runs the flow tests
npm run build
```

## 🧱 Stack

- **React 19** and **Next.js** app router, built with [vinext](https://github.com/cloudflare/vinext) and Vite
- **Cloudflare Workers** runtime with **D1** (SQLite) through **Drizzle ORM**
- **Tailwind CSS 4**
- Spotify Web Playback SDK with PKCE, and the YouTube IFrame player
- Hosted on OpenAI Sites; deploys use short-lived credentials, nothing is stored in the repo

## 🗺️ Project map

```
app/            pages, client components, and thin HTTP route shells
app/api/party/  the party API: parse, validate, dispatch
db/             party use cases, queue policy, awards, recap, backups
lib/            shared contracts, link parsing, formatting, security helpers
drizzle/        SQL migrations
tests/          end-to-end flows against the built worker and an in-memory D1
worker/         Cloudflare Worker entry with security headers
```

Routes stay thin, domain logic lives in `db/`, and the UI consumes shared contracts from `lib/party-contract.ts`.

## 🔒 Rules the server enforces

These are not just hidden in the UI.

- Host controls need a host key. Joining needs the room passcode.
- A track appears once per event. One reaction per person per song. No reacting to your own song.
- Song pickers and boo identities stay hidden until the party ends.
- Scores are hidden until the host ends the event.
- Rooms cap at 100 participants and 100 pending songs per person.
- Cross-origin writes are rejected and room creation is rate-limited.

The owner dashboard lives at a secret path that exists only in the hosting environment, and it requires ChatGPT sign-in plus an email allowlist. Any other path under `/backstage/` is a plain 404. It never returns host keys. Its backup export is encrypted in the owner's browser before download and can be verified with `npm run backup:decrypt`.

Never commit `.env*` files other than `.env.example`, host keys, passcodes, or database exports.

## 🙏 Credits

Reaction sounds come from Pixabay under the Pixabay Content License. See `public/sounds/ATTRIBUTION.md`.

Scrambled by [Roman Kushnarenko](https://sromku.com) with an AI coding agent. AGI unlocked, common sense still in beta.

## 📄 License

[MIT](LICENSE)
