import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/admin", () => ({ adminDb: vi.fn() }));
const { normalizeItem } = await import("@/lib/firestore/data");

describe("normalizeItem", () => {
  it("survives an empty doc", () => {
    expect(normalizeItem("x", undefined)).toMatchObject({ id: "x", title: "Untitled", type: "movie", status: "want", genres: [], tags: [], externalIds: {}, progress: null, archivedAt: null });
  });

  it("unwraps a proxy envelope", () => {
    const i = normalizeItem("x", { updatedAt: "t", data: { title: "Heat", type: "movie", status: "finished" } });
    expect(i).toMatchObject({ title: "Heat", status: "finished" });
  });

  it("drops junk values instead of passing them on", () => {
    const i = normalizeItem("x", { title: "X", type: "podcast", status: "done", genres: ["A", 3, ""], progress: { season: "2", episode: 4 }, rating: "5", externalIds: { tmdb: "1", imdb: "tt1" } });
    expect(i).toMatchObject({ type: "movie", status: "want", genres: ["A"], progress: { episode: 4 }, rating: null, externalIds: { imdb: "tt1" } });
  });
});
