import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/admin", () => ({ adminDb: vi.fn(), adminAuth: vi.fn(), adminStorage: vi.fn() }));
const { parseImport, pickMatch, importInput } = await import("@/lib/media/import");
const { planNewItem } = await import("@/lib/media/item-write");
import type { CatalogEntry } from "@/lib/lookup/catalog";

function entry(over: Partial<CatalogEntry>): CatalogEntry {
  return {
    ref: { source: "tmdb", id: "1", type: "movie" },
    type: "movie",
    title: "Heat",
    year: 1995,
    creator: "Michael Mann",
    overview: null,
    posterUrl: "https://image.tmdb.org/p.jpg",
    genres: ["Crime"],
    runtimeMinutes: 170,
    pageCount: null,
    seasonCount: null,
    externalIds: { tmdb: 949, imdb: "tt0113277" },
    streaming: [],
    ...over,
  };
}

describe("parseImport", () => {
  it("accepts { items } or a bare array", () => {
    expect(parseImport('{"items":[{"type":"movie","title":"Heat"}]}').ok).toBe(true);
    expect(parseImport('[{"type":"book","title":"Walden"}]').ok).toBe(true);
  });
  it("names the bad rows", () => {
    const r = parseImport('[{"type":"movie","title":"Heat"},{"type":"song","title":"X"},{"type":"book","title":"Y","rating":7}]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.slice(0, 6))).toEqual(["Item 2", "Item 3"]);
  });
  it("refuses non-JSON", () => {
    expect(parseImport("Heat, Walden").ok).toBe(false);
  });
});

describe("pickMatch", () => {
  const heat86 = entry({ year: 1986, ref: { source: "tmdb", id: "86", type: "movie" } });
  const heat95 = entry({});
  it("uses the year to pick the right film", () => {
    expect(pickMatch({ title: "Heat", year: 1995 }, [heat86, heat95])).toBe(heat95);
  });
  it("rejects results more than a year off", () => {
    expect(pickMatch({ title: "Heat", year: 2010 }, [heat86, heat95])).toBeNull();
  });
  it("prefers an exact title, ignoring case, accents and a leading article", () => {
    const other = entry({ title: "Heat Wave", year: null });
    const exact = entry({ title: "The Heat", year: null });
    expect(pickMatch({ title: "heat" }, [other, exact])).toBe(exact);
  });
  it("falls back to the first result without a year", () => {
    const a = entry({ title: "Blueprints" });
    expect(pickMatch({ title: "Blueprints: How Mathematics Shapes Creativity" }, [a])).toBe(a);
  });
});

describe("importInput", () => {
  it("takes catalog facts from the match and list state from the row", () => {
    const input = importInput(
      { type: "movie", title: "heat", year: 1995, status: "finished", rating: 5, finishedAt: "2020-02-09", tags: ["favorite"], whereToWatch: "Apple TV" },
      entry({ streaming: ["Netflix"] }),
    );
    expect(input).toMatchObject({ title: "Heat", posterUrl: "https://image.tmdb.org/p.jpg", externalIds: { imdb: "tt0113277" }, whereToWatch: "Netflix", status: "finished", rating: 5, tags: ["favorite"] });
  });
  it("falls back to the row's streaming and creator", () => {
    const input = importInput({ type: "movie", title: "Heat", creator: "Mann", whereToWatch: "Apple TV" }, entry({ streaming: [], creator: null }));
    expect(input).toMatchObject({ creator: "Mann", whereToWatch: "Apple TV" });
  });
  it("keeps the original finished date instead of stamping today", () => {
    const r = planNewItem(importInput({ type: "book", title: "Night", status: "finished", finishedAt: "2024-03-25" }, null), [], {
      id: "x",
      now: "2026-11-16T00:00:00Z",
      today: "2026-11-16",
    });
    expect(r.ok && r.item.finishedAt).toBe("2024-03-25");
  });
  it("still stamps today when a finished row has no date", () => {
    const r = planNewItem(importInput({ type: "book", title: "Day", status: "finished" }, null), [], { id: "x", now: "2026-11-16T00:00:00Z", today: "2026-11-16" });
    expect(r.ok && r.item.finishedAt).toBe("2026-11-16");
  });
});
