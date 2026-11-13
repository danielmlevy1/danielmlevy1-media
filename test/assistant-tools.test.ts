import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAssistantRoutes, handlerFetch, memoryNonceStore, runConformance } from "@daniellevy/assistant-kit";

/**
 * The v2 assistant's tools against an in-memory md_items store, so the real
 * write cores (status rules, duplicates, undo `before` values) run end to end.
 */

const store = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock("@/lib/firebase/admin", () => ({ adminDb: vi.fn(), adminAuth: vi.fn(), adminStorage: vi.fn() }));
vi.mock("@/lib/firestore/data", async (orig) => {
  const real = await orig<typeof import("@/lib/firestore/data")>();
  const all = () => [...store.entries()].map(([id, d]) => real.normalizeItem(id, d));
  return {
    ...real,
    itemsCol: () => ({
      doc: (id: string) => ({
        create: async (d: Record<string, unknown>) => {
          if (store.has(id)) throw new Error("exists");
          store.set(id, { ...d });
        },
        update: async (p: Record<string, unknown>) => store.set(id, { ...store.get(id)!, ...p }),
      }),
    }),
    getItems: async () => all().filter((i) => !i.archivedAt),
    getArchivedItems: async () => all().filter((i) => i.archivedAt),
    getItem: async (_uid: string, id: string) => (store.has(id) ? real.normalizeItem(id, store.get(id)) : null),
  };
});
vi.mock("@/lib/lookup/catalog", async (orig) => {
  const real = await orig<typeof import("@/lib/lookup/catalog")>();
  const sev = real.parseTmdbDetails(
    { id: 95396, name: "Severance", first_air_date: "2022-02-17", poster_path: "/p.jpg", number_of_seasons: 2, networks: [{ name: "Apple TV+" }], genres: [{ name: "Drama" }], external_ids: { imdb_id: "tt11280740" }, "watch/providers": { results: { US: { flatrate: [{ provider_name: "Apple TV+" }] } } } },
    "show",
  )!;
  return {
    ...real,
    searchCatalog: vi.fn(async () => [sev]),
    fetchDetails: vi.fn(async () => sev),
  };
});

const { MEDIA_TOOLS } = await import("@/lib/assistant/tools");

const URL_ = "https://test/media/api/assistant";
function app() {
  return createAssistantRoutes({
    app: "media",
    tools: MEDIA_TOOLS,
    nonceStore: memoryNonceStore(),
    secret: () => "test-secret",
    verifyUser: async (req) => (req.headers.get("authorization") ? { uid: "u1" } : null),
    onError: () => {},
  });
}
const routes = app();
const post = (body: unknown) =>
  routes.POST(new Request(URL_, { method: "POST", headers: { Authorization: "Bearer t" }, body: JSON.stringify(body) }));
async function call(tool: string, input: unknown) {
  const res = await post({ tool, input });
  return { status: res.status, data: (await res.json()) as any };
}
/** Propose then execute; returns the execute body. */
async function run(tool: string, input: unknown) {
  const p = await call(tool, input);
  expect(p.status, JSON.stringify(p.data)).toBe(200);
  const res = await post({ execute: p.data.proposal });
  expect(res.status).toBe(200);
  return (await res.json()) as any;
}
const undo = async (out: any) => {
  const res = await post({ execute: out.undo });
  expect(res.status).toBe(200);
  return res.json();
};

function seed(id: string, d: Record<string, unknown>) {
  store.set(id, { type: "movie", status: "want", genres: [], tags: [], externalIds: {}, createdAt: "2026-11-01T00:00:00Z", updatedAt: "", archivedAt: null, ...d });
}

beforeEach(() => {
  store.clear();
  seed("m1", { title: "Heat", year: 1995, runtimeMinutes: 170, recommendedBy: "Joey" });
  seed("m2", { title: "Past Lives", year: 2023, runtimeMinutes: 106 });
  seed("b1", { type: "book", title: "Dune", status: "in_progress", progress: { page: 120 }, startedAt: "2026-10-01" });
});

describe("media manifest", () => {
  it("passes the conformance runner without writing", async () => {
    const r = await runConformance({ url: URL_, token: "t", fetch: handlerFetch(app()) });
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(store.size).toBe(3);
  });

  it("marks every write tool undoable and exposes no internal collections", () => {
    const m = app().manifest;
    expect(m.tools.filter((t) => t.kind === "write" && !t.undoable).map((t) => t.name)).toEqual([]);
    expect(JSON.stringify(m)).not.toMatch(/md_agent_nonces|archivedAt/);
  });
});

describe("reads", () => {
  it("filters what to watch tonight by runtime and who recommended it", async () => {
    const short = await call("search_list", { type: "movie", status: "want", maxMinutes: 120 });
    expect(short.data.result.items.map((i: any) => i.title)).toEqual(["Past Lives"]);
    const joey = await call("search_list", { recommendedBy: "joey" });
    expect(joey.data.result.items.map((i: any) => i.id)).toEqual(["m1"]);
    expect(joey.data.result.counts).toEqual({ want: 2, in_progress: 1, finished: 0, dropped: 0 });
  });

  it("flags lookup results already on the list", async () => {
    await run("add_to_list", { type: "show", catalogRef: { source: "tmdb", id: "95396", type: "show" } });
    const r = await call("lookup_title", { type: "show", query: "severance" });
    expect(r.data.result[0].alreadyOnList.status).toBe("want");
  });
});

describe("writes", () => {
  it("adds from a catalog ref with details filled in and the user's extras kept", async () => {
    const p = await call("add_to_list", { type: "show", catalogRef: { source: "tmdb", id: "95396", type: "show" }, recommendedBy: "Ikey" });
    expect(p.data.proposal.summary).toBe("Add “Severance” (2022) (show) to Want to, from Ikey");
    expect(p.data.proposal.input).toMatchObject({ title: "Severance", seasonCount: 2, whereToWatch: "Apple TV+", externalIds: { imdb: "tt11280740" } });
    expect(p.data.proposal.input.catalogRef).toBeUndefined();
    const out = await post({ execute: p.data.proposal });
    const body = (await out.json()) as any;
    expect(store.get(body.result.itemId)).toMatchObject({ title: "Severance", recommendedBy: "Ikey", creator: "Apple TV+" });
    expect(body.undo).toMatchObject({ tool: "archive_item" });
  });

  it("refuses a duplicate", async () => {
    const r = await call("add_to_list", { type: "movie", title: "heat", year: 1995 });
    expect(r).toMatchObject({ status: 422, data: { error: "“Heat” is already on your list (Want to)." } });
  });

  it("records show progress, moving want to in progress, and undo puts it all back", async () => {
    const added = await run("add_to_list", { type: "show", title: "The Bear" });
    const id = added.result.itemId;
    const p = await call("set_progress", { itemId: id, season: 2, episode: 4 });
    expect(p.data.proposal.summary).toBe("Mark “The Bear” at S2 E4 (now in progress)");
    const out = await run("set_progress", { itemId: id, season: 2, episode: 4 });
    expect(store.get(id)).toMatchObject({ status: "in_progress", progress: { season: 2, episode: 4 } });
    expect(out.undo.input).toMatchObject({ itemId: id, status: "want", progress: null, startedAt: null });
    await undo(out);
    expect(store.get(id)).toMatchObject({ status: "want", progress: null, startedAt: null });
  });

  it("refuses episodes on a book", async () => {
    expect((await call("set_progress", { itemId: "b1", season: 1 })).status).toBe(422);
  });

  it("marks finished with a rating and undo restores the previous state", async () => {
    const out = await run("mark_finished", { itemId: "b1", rating: 5 });
    expect(store.get("b1")).toMatchObject({ status: "finished", rating: 5 });
    expect(typeof store.get("b1")!.finishedAt).toBe("string");
    await undo(out);
    expect(store.get("b1")).toMatchObject({ status: "in_progress", rating: null, finishedAt: null, startedAt: "2026-10-01" });
  });

  it("summarises an update from live data and refuses a no-op", async () => {
    const p = await call("update_item", { itemId: "m1", rating: 4, whereToWatch: "Netflix" });
    expect(p.data.proposal.summary).toBe("Update “Heat”: rating 4/5, where to watch");
    expect((await call("update_item", { itemId: "m1", recommendedBy: "Joey" })).data.error).toBe("Nothing to change.");
  });

  it("archives and restores, each undoing the other", async () => {
    const out = await run("archive_item", { itemId: "m2" });
    expect(store.get("m2")!.archivedAt).toBeTruthy();
    expect(out.undo).toMatchObject({ tool: "restore_item", summary: "Restore “Past Lives” from the trash" });
    await undo(out);
    expect(store.get("m2")!.archivedAt).toBeNull();
  });

  it("refuses ids that don't exist", async () => {
    expect((await call("archive_item", { itemId: "nope" })).status).toBe(422);
    expect((await call("restore_item", { itemId: "m1" })).data.error).toMatch(/isn't in the trash/);
  });
});
