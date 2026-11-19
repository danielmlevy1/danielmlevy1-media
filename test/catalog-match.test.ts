import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/admin", () => ({ adminDb: vi.fn(), adminAuth: vi.fn(), adminStorage: vi.fn() }));
const { planNewItem, planCatalogMatch } = await import("@/lib/media/item-write");
import type { MediaItem } from "@/lib/firestore/types";

const ctx = { id: "b1", now: "2026-11-17T00:00:00Z", today: "2026-11-17" };
function book(over: Partial<MediaItem> = {}): MediaItem {
  const r = planNewItem({ type: "book", title: "Night", creator: "Elie Wiesel", status: "finished", rating: 4, finishedAt: "2024-03-25" }, [], ctx);
  if (!r.ok) throw new Error("fixture");
  return { ...r.item, ...over };
}
const facts = {
  year: 1958,
  creator: "Elie Wiesel (translated)",
  overview: "A memoir.",
  posterUrl: "https://covers.openlibrary.org/b/id/1-L.jpg",
  genres: ["Memoir"],
  runtimeMinutes: null,
  pageCount: 120,
  seasonCount: null,
  externalIds: { openLibrary: "OL1W" },
};

describe("planCatalogMatch", () => {
  it("fills catalog fields and keeps list state, title and the typed author", () => {
    const r = planCatalogMatch(book(), facts, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch).toEqual({ externalIds: { openLibrary: "OL1W" }, posterUrl: facts.posterUrl, year: 1958, overview: "A memoir.", genres: ["Memoir"], pageCount: 120 });
    expect(r.patch).not.toHaveProperty("creator");
    expect(r.patch).not.toHaveProperty("status");
    expect(r.patch).not.toHaveProperty("title");
  });
  it("refuses a match another item already has", () => {
    const other = book({ id: "b2", title: "La Nuit", externalIds: { openLibrary: "OL1W" } });
    expect(planCatalogMatch(book(), facts, [other]).ok).toBe(false);
  });
  it("ignores the item itself and archived items", () => {
    const self = book();
    const gone = book({ id: "b3", externalIds: { openLibrary: "OL1W" }, archivedAt: "2026-01-01" });
    expect(planCatalogMatch(self, facts, [self, gone]).ok).toBe(true);
  });
});

describe("Open Library retry", () => {
  it("tries a slow Open Library search a second time", async () => {
    const { searchCatalog } = await import("@/lib/lookup/catalog");
    let calls = 0;
    const f = (async () => {
      calls++;
      if (calls === 1) throw new Error("timeout");
      return new Response(JSON.stringify({ docs: [{ key: "/works/OL55649W", title: "Walden", author_name: ["Henry David Thoreau"], first_publish_year: 1854 }] }), { status: 200 });
    }) as typeof fetch;
    const r = await searchCatalog("book", "Walden", { fetchImpl: f });
    expect(calls).toBe(2);
    expect(r[0]?.title).toBe("Walden");
  });
  it("doesn't retry TMDB", async () => {
    const { searchCatalog } = await import("@/lib/lookup/catalog");
    process.env.TMDB_API_KEY = "x".repeat(32);
    let calls = 0;
    const f = (async () => {
      calls++;
      throw new Error("timeout");
    }) as typeof fetch;
    await expect(searchCatalog("movie", "Heat", { fetchImpl: f })).rejects.toThrow();
    expect(calls).toBe(1);
    delete process.env.TMDB_API_KEY;
  });
});
