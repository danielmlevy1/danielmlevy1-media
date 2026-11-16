import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/admin", () => ({ adminDb: vi.fn(), adminAuth: vi.fn(), adminStorage: vi.fn() }));
const { planNewItem, planChanges, findDuplicate, titleKey, localToday } = await import("@/lib/media/item-write");
import type { MediaItem } from "@/lib/firestore/types";

const ctx = { id: "i1", now: "2026-11-13T15:00:00.000Z", today: "2026-11-13" };

function item(over: Partial<MediaItem> = {}): MediaItem {
  const r = planNewItem({ type: "show", title: "Severance", year: 2022, externalIds: { tmdb: 95396 } }, [], ctx);
  if (!r.ok) throw new Error("bad fixture");
  return { ...r.item, ...over };
}

describe("planNewItem", () => {
  it("defaults to want with no dates", () => {
    const i = item();
    expect(i).toMatchObject({ status: "want", startedAt: null, finishedAt: null, progress: null, rating: null });
  });

  it("stamps startedAt / finishedAt when added straight into those statuses", () => {
    const a = planNewItem({ type: "movie", title: "Dune", status: "in_progress" }, [], ctx);
    const b = planNewItem({ type: "movie", title: "Heat", status: "finished", rating: 5 }, [], ctx);
    expect(a.ok && a.item.startedAt).toBe("2026-11-13");
    expect(b.ok && b.item.finishedAt).toBe("2026-11-13");
  });

  it("moves to in_progress when added with progress and no status", () => {
    const r = planNewItem({ type: "book", title: "Dune", progress: { page: 40 } }, [], ctx);
    expect(r.ok && r.item.status).toBe("in_progress");
  });

  it("refuses an empty title, a bad rating and progress that doesn't fit the type", () => {
    expect(planNewItem({ type: "movie", title: "  " }, [], ctx).ok).toBe(false);
    expect(planNewItem({ type: "movie", title: "X", rating: 6 }, [], ctx).ok).toBe(false);
    expect(planNewItem({ type: "movie", title: "X", rating: 3.5 }, [], ctx).ok).toBe(false);
    expect(planNewItem({ type: "movie", title: "X", progress: { page: 3 } }, [], ctx).ok).toBe(false);
    expect(planNewItem({ type: "show", title: "X", progress: { page: 3 } }, [], ctx).ok).toBe(false);
    expect(planNewItem({ type: "book", title: "X", progress: { episode: 3 } }, [], ctx).ok).toBe(false);
    expect(planNewItem({ type: "book", title: "X", progress: { percent: 140 } }, [], ctx).ok).toBe(false);
  });

  it("refuses a duplicate by catalog id or by title + year, but not across types or from the trash", () => {
    const existing = [item()];
    const byId = planNewItem({ type: "show", title: "Severance (2022)", externalIds: { tmdb: 95396 } }, existing, ctx);
    expect(byId).toEqual({ ok: false, errors: ["“Severance” is already on your list (Want to)."] });
    expect(planNewItem({ type: "show", title: "severance", year: 2022 }, existing, ctx).ok).toBe(false);
    expect(planNewItem({ type: "show", title: "Severance", year: 1999 }, existing, ctx).ok).toBe(true);
    expect(planNewItem({ type: "book", title: "Severance" }, existing, ctx).ok).toBe(true);
    expect(planNewItem({ type: "show", title: "Severance" }, [item({ archivedAt: "2026-11-01" })], ctx).ok).toBe(true);
  });
});

describe("planChanges", () => {
  it("returns only what changes, with the old values as before", () => {
    const r = planChanges(item({ notes: "old" }), { notes: "old", rating: 4 }, "2026-11-14");
    expect(r).toEqual({ ok: true, patch: { rating: 4 }, before: { rating: null } });
  });

  it("promotes want to in_progress on progress and stamps the start date", () => {
    const r = planChanges(item(), { progress: { season: 2, episode: 4 } }, "2026-11-14");
    expect(r.ok && r.patch).toEqual({ progress: { season: 2, episode: 4 }, status: "in_progress", startedAt: "2026-11-14" });
    expect(r.ok && r.before).toEqual({ progress: null, status: "want", startedAt: null });
  });

  it("keeps an existing start date and stamps finishedAt once", () => {
    const i = item({ status: "in_progress", startedAt: "2026-10-01" });
    const r = planChanges(i, { status: "finished" }, "2026-11-14");
    expect(r.ok && r.patch).toEqual({ status: "finished", finishedAt: "2026-11-14" });
    const again = planChanges({ ...i, status: "finished", finishedAt: "2026-11-14" }, { status: "finished" }, "2026-11-20");
    expect(again.ok && again.patch).toEqual({});
  });

  it("uses an explicit date over the stamp, and null clears", () => {
    const r = planChanges(item(), { status: "finished", finishedAt: "2026-01-02" }, "2026-11-14");
    expect(r.ok && r.patch).toEqual({ status: "finished", finishedAt: "2026-01-02" });
    const cleared = planChanges(item({ rating: 3 }), { rating: null }, "2026-11-14");
    expect(cleared.ok && cleared.patch).toEqual({ rating: null });
  });

  it("refuses bad values", () => {
    expect(planChanges(item(), { title: " " }, "x").ok).toBe(false);
    expect(planChanges(item(), { progress: { page: 4 } }, "x").ok).toBe(false);
    expect(planChanges(item(), { finishedAt: "11/14/2026" }, "x").ok).toBe(false);
    expect(planChanges(item({ type: "movie" }), { progress: { season: 1 } }, "x").ok).toBe(false);
  });

  it("puts things back when the before values are applied (undo)", () => {
    const i = item();
    const fwd = planChanges(i, { progress: { season: 1, episode: 3 } }, "2026-11-14");
    if (!fwd.ok) throw new Error();
    const after = { ...i, ...fwd.patch } as MediaItem;
    const back = planChanges(after, fwd.before, "2026-11-14");
    expect(back.ok && { ...after, ...back.patch }).toEqual(i);
  });
});

describe("helpers", () => {
  it("titleKey ignores case, punctuation, accents and a leading article", () => {
    expect(titleKey("The Bear")).toBe(titleKey("bear"));
    expect(titleKey("Amélie!")).toBe("amelie");
  });

  it("findDuplicate matches by IMDb id across catalogs", () => {
    const i = item({ externalIds: { tvmaze: 1, imdb: "tt11280740" } });
    expect(findDuplicate([i], { type: "show", title: "Different name", externalIds: { tmdb: 5, imdb: "tt11280740" } })?.id).toBe("i1");
  });

  it("localToday uses New York time", () => {
    expect(localToday(new Date("2026-11-14T03:00:00Z"))).toBe("2026-11-13");
  });
});
