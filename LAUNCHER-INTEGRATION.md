# LAUNCHER-INTEGRATION.md — the shared contract

**This is the single source of truth for how the personal-apps suite fits together.**
Every session — the launcher/integration session **and** each app's own session (Holdings,
Travel/Wayfare, Tax, Insurance) — should read this first and keep it accurate. If your app changes
something covered here, update this file (in every repo) in the same change.

Canonical copy lives in `launcher-site`; an identical copy is committed into each app repo.

---

## 1. The system at a glance

```
  You ─► Portal (launcher)  ──────────────────────────────────────────┐
         │  home.* / launcher-site-nu.vercel.app                       │
         │  embeds <app-agent scope="all">  (the ORCHESTRATOR)         │
         │                                                             │
         ├─ plan → delegate → collect → confirm → synthesize           │
         │        │                                                    │
         ▼        ▼                                                    ▼
   Firebase   SUB-AGENTS (one per app)                          Each APP (own site)
   (shared)   • Holdings: its own /api/agent-task               • embeds <app-agent scope="X">
              • Travel/Tax/Insurance: the generic sub-agent        (its own in-app agent)
                on the proxy (/api/agent-task?app=X)             • SSO: portal tile hands off
                                                                   your token → you're signed in

  SHARED PROXY  →  https://tax-ten-mu.vercel.app
    /api/firestore     reads + guardrailed writes (holds the Firebase Admin service account)
    /api/gemini        reasoning (holds the Gemini key — apps never hold it)
    /api/agent-config  central data-model registry (what each agent knows about each app)
    /api/agent-task    the GENERIC sub-agent (for plain-CRUD apps), ?app=<id>
    /api/custom-token  mint a Firebase custom token for client-auth apps (Travel SSO)
```

**Three layers, deliberately separated:**
| Layer | Lives | One or many |
|---|---|---|
| Data | Each app's Firestore (`hp_`/`wf_`/`tx_`/`ins_`) | per app |
| Business logic | Each app (server actions / its own sub-agent endpoint) | per app |
| The agent brain | One shared `<app-agent>` web component, embedded everywhere | ONE |

---

## 2. Shared infrastructure (constants — do not fork)

- **Firebase project:** `travel-companion-23697` (ALL apps share it). Owner UID: `WtoffYfQTdQveyKzJnc5XRIqYRA2`.
- **Shared proxy:** `https://tax-ten-mu.vercel.app` (endpoints above). Owned by the launcher session (`~/launcher-proxy`). Apps call it; they never hold the Gemini key or the service account.
- **Agent bundle:** `https://launcher-site-nu.vercel.app/app-agent.js` — the `<app-agent>` web component. Embed it; never fork it. (It also floats the shared **🏠 Portal** + **Agent** buttons on every app — don't re-add them.)
- **Design system:** `https://launcher-site-nu.vercel.app/design-tokens.css` + **`DESIGN-SYSTEM.md`** — the single source of truth for the suite's look (dark-first Inter palette, rounded cards, top-bar→hamburger nav). Every app `@import`s the tokens and references the vars; never hardcode colors/fonts/spacing or fork the token file. See DESIGN-SYSTEM.md to adopt.
- **Auth model:** all apps authenticate the same Firebase user. Cookie apps mint a `__session` cookie from an ID token; the client-auth app (Travel) uses client-side Firebase persistence.

---

## 3. The contract — what EVERY app must provide & keep working

If any of these break, the portal integration breaks silently. Treat them as public API.

### 3a. Registry entry (data model) — REQUIRED
Your app's data model lives in the central registry (`~/launcher-proxy/api/_registry.js`, served by
`/api/agent-config`). The agents route + extract fields from it. **Your app is the source of truth for
its own schema; the registry MUST mirror it.** If you add/rename/remove a collection or field, the
registry entry is now stale → the agent will mis-route or write bad data. **When your schema changes,
update the registry entry in the same change** (edit `_registry.js` and redeploy the proxy, or flag the
launcher session to do it). Keep the `dataModel` text accurate, concrete, and field-level.

### 3b. Auth — REQUIRED
- **Cookie apps (Holdings, Tax, Insurance):** keep `POST /auth/session` working — body `{ idToken }`,
  verifies via Admin `verifyIdToken`, sets the httpOnly `__session` cookie. This is how both normal
  sign-in AND the portal SSO handoff establish a session. Google sign-in enabled on the shared project.
- **Client-auth app (Travel):** keeps client-side Firebase auth (config via `NEXT_PUBLIC_FIREBASE_CONFIG`).

### 3c. SSO handoff receiver — REQUIRED (so tiles sign you in)
The portal appends a fresh ID token to your tile URL as `#__aht=<token>` (URL fragment — never sent to a
server, stripped immediately on arrival). Your app catches it on load:
- **Cookie apps:** `AuthHandoff` client component in the root layout — reads `#__aht=`, strips it,
  `POST`s `{ idToken }` to `/auth/session`, then continues signed-in.
- **Travel:** `AuthHandoff` exchanges the token via the proxy's `/api/custom-token`, then
  `signInWithCustomToken` client-side.

### 3d. In-app agent — REQUIRED (each app gets its own agent)
In your root layout, mount the shared component scoped to your app:
- **Cookie apps:** add `GET /api/agent-token` (reads `__session` cookie → `adminAuth().createCustomToken(uid)`
  → `{ ok, token }`, exempted in middleware) and mount `<AgentEmbed scope="X" />` which loads the bundle +
  mounts `<app-agent scope="X" token-endpoint="/api/agent-token">`.
- **Travel:** `AgentEmbed` exposes `window.appAgentGetToken = () => auth.currentUser.getIdToken()` and
  mounts `<app-agent scope="travel">` (no token-endpoint).

### 3e. Sub-agent (`POST /api/agent-task`) — ONLY IF your app has business-logic writes
Plain-CRUD apps use the shared GENERIC sub-agent on the proxy (nothing to build). Build your OWN
`/api/agent-task` **only** when a write needs your app's own logic/side-effects (e.g. Holdings
`createEntity` runs a compliance rule-engine; Tax charity-pledge/K-1 creates set `holderUserIds`/
`visibility`). See §4 for the contract; **Holdings' `lib/agent/holdings-subagent.ts` is the reference
implementation.** Extract the create core so the web form and the sub-agent share ONE code path — never
reimplement business logic. Report the deployed URL to the launcher session to register as `subAgentUrl`.

### 3f. The "don't break" list
- `/auth/session`, `/api/agent-token`, `/api/agent-task` must stay **exempt in `middleware.ts`** (they do
  their own auth). CORS on `/api/agent-task`: `Access-Control-Allow-Origin: *` (the portal calls it cross-origin).
- **No Content-Security-Policy** that blocks loading `launcher-site-nu.vercel.app/app-agent.js` or connecting
  to the proxy / gstatic (Firebase) / identitytoolkit. If you add a CSP, allow those origins.
- Don't change your production Vercel alias without telling the launcher session (tile URLs + `subAgentUrl`
  point at it). Keep the alias **unprotected** (no Vercel Authentication) — the app self-auths via Firebase;
  a Vercel-auth wall breaks cross-origin API calls and the SSO fragment.
- Never hold the Gemini key or the Firebase service account for agent purposes — reason via `/api/gemini`.

---

## 4. Sub-agent contract (`POST /api/agent-task`)

**Request** (from the orchestrator): headers `Authorization: Bearer <user Firebase ID token>` (uid-gated to owner).
```jsonc
{ "task": "self-contained instruction for THIS app",
  "intent": "query | mutate",
  "context": { "userPhrasing": "..." },
  "execute": null }   // on the 2nd (confirm) call, the proposedAction to perform
```
**Response** (report back):
```jsonc
{ "ok": true, "app": "<id>", "answer": "natural-language result",
  "proposedActions": [ { "id":"...", "description":"...", "operation":"insert|update|archive|create…",
                         "collection":"...", "docId":"...", "parentPath":"...", "payload":{...}, "risk":"low|med|high" } ],
  "executed": [], "confidence": "high|med|low" }
```
**Hard rules:** a mutating request returns `proposedActions` and writes **nothing** — the orchestrator shows
one confirm card, then re-calls with `execute` set to perform exactly one action. Reads/aggregates answer
immediately. **Never do arithmetic in an "answer"** — return an `aggregate` instruction and let the backend
compute it (LLMs are unreliable at math). USD-normalized amount fields for money totals.

---

## 5. Conventions (all apps)
- Collections: `snake_case`, plural, per-app prefix (`hp_` Holdings, `wf_` Travel, `tx_` Tax, `ins_` Insurance). Fields: `camelCase`.
- Soft delete: `archivedAt` (ISO or null) — never hard-delete via the agent (`archive`, not `delete`).
- Money: `number`, USD. Dates: ISO 8601 instant for timestamps, `"YYYY-MM-DD"` for calendar dates. IDs: `randomUUID()`.
- `createdBy`/`createdAt`/`updatedAt` on records; the app owns access-control fields (members, `holderUserIds`, `visibility`).
- Proxy write guardrails: `wf_`/`ins_` allow top-level inserts; `hp_`/`tx_` are archive-not-delete and only allow
  agent inserts into append-only subcollections — **top-level `hp_`/`tx_` creates must go through your app's own
  create logic (a sub-agent create path), not the generic proxy.**

---

## 6. Division of labor
- **Launcher session (me):** the `<app-agent>` component + orchestrator; the shared proxy (all its endpoints);
  the central registry; SSO passthrough on the portal; registering each app's `subAgentUrl`.
- **Each app session:** upholds §3 for its app; owns its data + business logic; builds its own `/api/agent-task`
  only when it has business-logic writes; keeps the registry entry accurate when its schema changes.

---

## 7. Per-app status (update as things land)

| Contract item | Holdings | Travel (Wayfare) | Tax | Insurance |
|---|---|---|---|---|
| In registry / data model | ✅ | ✅ | ✅ | ✅ |
| `/auth/session` (cookie) | ✅ | n/a (client auth) | ✅ | ✅ |
| SSO handoff receiver | ✅ cookie | ✅ custom-token | ✅ cookie | ✅ cookie |
| Unified domain (basePath, same-origin `/<app>`) | ✅ `/holdings` | ✅ `/travel` | ✅ `/tax` | ✅ `/insurance` |
| Portal SSO verified end-to-end (2026-08-11) | ✅ | ✅ | ✅ | ✅ |
| `/api/agent-token` | ✅ | n/a (client getter) | ✅ | ✅ |
| In-app `<AgentEmbed>` | ✅ | ✅ | ✅ | ✅ |
| Own `/api/agent-task` sub-agent | ✅ (createEntity + compliance) | generic proxy, reads trip tree (§7a) | ✅ (own endpoint; charity-pledge creates) | generic proxy |
| Doc-upload → create | ✅ entities | ✅ (wf_ inserts) | ✅ (pledges via its sub-agent) | ✅ (ins_ inserts) |

Charity is owned solely by **Tax** (`tx_charity_pledges`); Holdings is retiring its charity feature — route all charity to Tax.

### 7b. Unified domain (Next.js Multi-Zones) — landed 2026-08-11
All 4 apps are served **same-origin** under the launcher: `launcher-site-nu.vercel.app/{holdings,travel,tax,insurance}`. Each app sets `basePath` in `next.config` + a `lib/base-path.ts` (`api()` helper); the launcher `vercel.json` rewrites `/<app>/:path*` → the app's deploy. Bare app URLs now 404 (expected). This is what makes SSO clean (same origin) and fixes mobile sign-in (no cross-site storage partitioning). **basePath rules every app must keep:** (1) middleware `nextUrl.pathname` is basePath-STRIPPED and Next re-adds basePath on redirects — never prefix `BASE` in middleware (→ `/app/app/…` 404); (2) `fetch()` is NOT auto-prefixed — wrap same-app fetches in `api()`; (3) AuthHandoff post-login redirect must re-prepend basePath and special-case root (`api('/')` = `/app/` trailing-slash 404s → send root to BASE); (4) `__session` cookie `path=/<app>` (+ matching `clearSession` delete). **Model:** suite standard is the alias `gemini-flash-latest` (off deprecated `gemini-2.5-flash`); proxy `GEMINI_MODEL` env decides — apps route model-less through `/api/gemini` or use `process.env.GEMINI_MODEL || 'gemini-flash-latest'`. The shared `app-agent.js` injects a 🏠 Portal button in every app (hidden only on the launcher, `scope="all"`).

Reference implementation for a full app sub-agent: **Holdings** —
`lib/agent/holdings-subagent.ts`, `app/api/agent-task/route.ts`, `lib/entities/create-entity-core.ts`.

### 7a. Travel (Wayfare) — the proxy reads the canonical trip tree (2026-10-23)
Travel keeps using the generic sub-agent (no own `/api/agent-task`). The proxy's `api/_travel.js` maps the registry names onto Wayfare's real storage, so the agent sees and edits exactly what the app shows — **including trips shared with you** (`memberUids` contains your uid):
- `wf_trips` → `trips/{tripId}` (`{ownerUid, memberUids[], updatedAt, data}`); `wf_destinations|wf_itinerary_items|wf_expenses|wf_photo_albums` → `trips/{tripId}/destinations|itinerary|expenses|photoAlbums/{id}` (`{updatedAt, data}`). Inserts must carry the `tripId` of a trip you're a member of.
- User-global tables stay at `users/{uid}/wf_documents|wf_resources|wf_resource_links|wf_people|wf_settlements`.
- **Remove = the app's own delete, not `archivedAt`** (Wayfare ignores `archivedAt`): the proxy writes a tombstone (`trips/{tripId}/deletions/{table}__{id}` or `users/{uid}/wf_deletions/...`, `{table,rowId,deletedAt}` + a `snapshot` of the removed data for recovery) and removes the doc; every member's app applies it on sync. Only a trip's owner can remove a shared trip. `delete` is refused.
- Splits/balances: `computeBalances` (`api/agent-task.js`) reads expenses from the tree, so balances work on shared trips too. `wf_people`/`wf_settlements` are still per-user.
- The old one-way `users/{uid}/wf_expenses` mirror is no longer read by the proxy.
- If Wayfare's storage layout changes (`src/lib/sync/engine.ts` TRIP_CHILDREN/USER_TABLES), update `api/_travel.js` in the same change.

---

## 8. When you change something — checklist
- Changed your **data model**? → update the registry entry (`_registry.js`) so the agent stays accurate.
- Added a **business-logic create**? → put it in a shared core, expose it via your `/api/agent-task`, report the URL.
- Changed your **Vercel alias** or added a **CSP**? → tell the launcher session; update tile URL / `subAgentUrl` / CSP allowances.
- Touched `/auth/session`, `/api/agent-token`, `middleware.ts`, or the root layout? → re-verify SSO + the in-app agent still work.
- Update this file (§7 status + any changed contract) in the same change, in every repo.
