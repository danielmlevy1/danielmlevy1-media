# Media — agent & contributor notes

A to-watch / to-read list and tracker for shows, movies and books: add by
searching, track season/episode or page, rate when finished, note who
recommended it and where it streams. Part of the suite on Firebase project
**travel-companion-23697**; scaffolded from Recipes, so conventions match.

## Launcher integration (read first)
Contract: [`LAUNCHER-INTEGRATION.md`](./LAUNCHER-INTEGRATION.md). Cookie-auth app
(`/auth/session` → `__session` cookie scoped to `/media`).
- basePath **`/media`**. `fetch()` isn't prefixed: use `lib/base-path.ts` `api()`.
- `POST /auth/session`, `GET /api/agent-token` and `/api/assistant` are exempt in
  `middleware.ts` (they self-auth).
- `AuthHandoff` (SSO `#__aht=`) + `AgentEmbed scope="media"` in `app/layout.tsx`.
- The launcher rewrites `/media/*` to this deploy (launcher-site `vercel.json`);
  keep the prod alias unprotected (no Vercel Authentication).
- Registered in launcher-proxy `api/_registry.js` with `assistantUrl`. No v1
  `/api/agent-task`: this app was built on assistant v2 only.

## Stack
Next.js 15 (App Router, TS strict) + Tailwind 4 on the suite design tokens;
Firebase Auth + Firestore (Admin SDK on the server); Vercel. No AI calls of its
own: the suite assistant reasons in the proxy and reaches this app via tools.

## Data model (per-user PRIVATE under `users/{uid}/`, plain docs, `md_` prefix)
- `md_items`: type movie|show|book, title, year, creator (director / author /
  network), overview, posterUrl, genres[], runtimeMinutes, pageCount,
  seasonCount, externalIds {tmdb?, tvmaze?, imdb?, openLibrary?, isbn?},
  status want|in_progress|finished|dropped, progress {season?, episode?, page?,
  percent?}, rating 1–5, notes, recommendedBy, whereToWatch, tags[],
  startedAt/finishedAt (YYYY-MM-DD), createdAt, updatedAt, archivedAt.
- `md_agent_nonces`: burnt confirm-token nonces (internal).
Types: `lib/firestore/types.ts`. Readers go through `normalizeItem`
(`lib/firestore/data.ts`); never cast `d.data() as MediaItem`.

## Write rules (all in `lib/media/item-write.ts`; every writer uses it)
- Moving to in_progress stamps `startedAt`, to finished stamps `finishedAt`,
  each only if empty and not given explicitly. Dates are New York days.
- Progress on a "want" item moves it to in_progress.
- Progress must fit the type: season/episode (show), page/percent (book), none (movie).
- Rating is a whole 1–5 or null.
- No duplicates: same catalog id (TMDB / TVmaze / IMDb / Open Library) or same
  type + normalized title (+ year when both have one). Archived items don't count.
- Delete = archive. Nothing hard-deletes.
`planNewItem` / `planChanges` are pure and unit-tested; `planChanges` returns
`before` (old values) which is what Undo puts back.

## Title lookup (`lib/lookup/catalog.ts`)
- Movies + shows: TMDB, needs **`TMDB_API_KEY`** (v3 key or v4 read token; a
  token starting `eyJ` is sent as a Bearer header). Details add IMDb id,
  runtime, seasons, director/network, US streaming (JustWatch via TMDB).
- Shows without a key: TVmaze (keyless). Movies without a key: manual add only.
- Books: Open Library (keyless); details add the work's description.
- Posters are hotlinked from the catalog CDNs (they allow it).
IMDb itself has no free API; items link to IMDb via the stored id.

## Assistant v2 tools (`lib/assistant/tools.ts`, served at `/api/assistant`)
Reads: `search_list`, `get_item`, `list_trashed_items`, `lookup_title`.
Writes: `add_to_list` (takes a lookup `ref`; propose resolves it to full
details, which is what gets signed), `update_item`, `set_progress`,
`mark_finished`, `archive_item`, `restore_item`. Every write has an `undo`
(add ↔ archive, archive ↔ restore, updates put back `before`). Summaries come
from `propose`, never the model. A new write tool needs an `undo` (tested).

## Tests
`npm test` (vitest). Write rules, catalog parsers (recorded responses, no
network), normalizer, and the tools end to end against an in-memory store
(conformance, summaries, undo round-trips). CI runs `tsc` + tests.

## Env (.env.local + Vercel)
`NEXT_PUBLIC_FIREBASE_CONFIG`, `FIREBASE_SERVICE_ACCOUNT_KEY`,
`AGENT_CONFIRM_SECRET` (shared with the suite; writes fail closed without it),
`TMDB_API_KEY` (optional; movie search + richer show details). Port 3095.
