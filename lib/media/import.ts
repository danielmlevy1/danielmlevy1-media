/**
 * Bulk import from a JSON list (e.g. lists moved over from Notion).
 *
 * Two steps, so nothing is saved until the user has looked at the matches:
 *   1. preview: each row is looked up in its catalog and the best match shown.
 *   2. commit: the chosen catalog entry (re-fetched by ref on the server, never
 *      trusted from the client) is merged with the row's list state and saved
 *      through createItemRecord, so every write rule and the duplicate check apply.
 *
 * The pure pieces (parse, pickMatch, importInput) are unit-tested.
 */

import { z } from "zod";
import { MEDIA_STATUSES, MEDIA_TYPES } from "@/lib/firestore/types";
import type { CatalogEntry } from "@/lib/lookup/catalog";
import type { NewItemInput } from "@/lib/media/item-write";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ImportRowSchema = z.object({
  type: z.enum(MEDIA_TYPES as unknown as ["movie", "show", "book"]),
  title: z.string().trim().min(1),
  year: z.number().int().nullish(),
  creator: z.string().nullish(),
  status: z.enum(MEDIA_STATUSES as unknown as ["want", "in_progress", "finished", "dropped"]).optional(),
  rating: z.number().int().min(1).max(5).nullish(),
  notes: z.string().nullish(),
  recommendedBy: z.string().nullish(),
  whereToWatch: z.string().nullish(),
  tags: z.array(z.string()).optional(),
  startedAt: date.nullish(),
  finishedAt: date.nullish(),
});
export type ImportRow = z.infer<typeof ImportRowSchema>;

export const MAX_IMPORT_ROWS = 500;

/** Accepts `{ items: [...] }` or a bare array. Returns rows or readable errors. */
export function parseImport(text: string): { ok: true; rows: ImportRow[] } | { ok: false; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["That isn't valid JSON."] };
  }
  const list = Array.isArray(data) ? data : (data as { items?: unknown })?.items;
  if (!Array.isArray(list)) return { ok: false, errors: ["Expected a list of items (or { \"items\": [...] })."] };
  if (list.length > MAX_IMPORT_ROWS) return { ok: false, errors: [`At most ${MAX_IMPORT_ROWS} items at a time.`] };
  const rows: ImportRow[] = [];
  const errors: string[] = [];
  list.forEach((raw, i) => {
    const r = ImportRowSchema.safeParse(raw);
    if (r.success) rows.push(r.data);
    else errors.push(`Item ${i + 1}: ${r.error.issues.map((x) => `${x.path.join(".") || "item"} ${x.message}`).join("; ")}`);
  });
  return errors.length ? { ok: false, errors } : { ok: true, rows };
}

const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/^(the|a|an) /, "").trim();

/** Last word of each name ("Henry David Thoreau" → "thoreau"). */
const surnames = (creator: string) =>
  creator.split(/,|&| and /).map((n) => norm(n).split(" ").pop() ?? "").filter((x) => x.length > 1);

/**
 * Best search result for a row. With a year, only a result within a year of
 * it counts (Heat 1995, not Heat 1986); an exact title beats a partial one.
 * For a book with a known author, the result's author must share a surname
 * (so "Night" by Elie Wiesel can't land on someone else's "Night").
 * No acceptable result → null, and the row is added / left as typed.
 */
export function pickMatch(row: Pick<ImportRow, "title" | "year"> & { creator?: string | null }, results: CatalogEntry[]): CatalogEntry | null {
  const t = norm(row.title);
  const yearOk = (e: CatalogEntry) => !row.year || !e.year || Math.abs(e.year - row.year) <= 1;
  const want = row.creator ? surnames(row.creator) : [];
  const authorOk = (e: CatalogEntry) => {
    if (e.type !== "book" || !want.length) return true;
    if (!e.creator) return false;
    const got = surnames(e.creator);
    return want.some((w) => got.includes(w));
  };
  const candidates = results.filter((e) => yearOk(e) && authorOk(e));
  return (
    candidates.find((e) => norm(e.title) === t && e.year === row.year) ??
    candidates.find((e) => norm(e.title) === t) ??
    (row.year ? candidates.find((e) => e.year === row.year) : undefined) ??
    candidates[0] ??
    null
  );
}

/**
 * The item to save: catalog facts from the match (when there is one), list
 * state from the row. The row's creator / streaming are a fallback only.
 */
export function importInput(row: ImportRow, entry: CatalogEntry | null): NewItemInput {
  const list = {
    status: row.status ?? "want",
    rating: row.rating ?? null,
    notes: row.notes ?? null,
    recommendedBy: row.recommendedBy ?? null,
    tags: row.tags ?? [],
    startedAt: row.startedAt ?? null,
    finishedAt: row.finishedAt ?? null,
  } as const;
  if (!entry) {
    return { type: row.type, title: row.title, year: row.year ?? null, creator: row.creator ?? null, whereToWatch: row.whereToWatch ?? null, ...list };
  }
  return {
    type: entry.type,
    title: entry.title,
    year: entry.year ?? row.year ?? null,
    creator: entry.creator ?? row.creator ?? null,
    overview: entry.overview,
    posterUrl: entry.posterUrl,
    genres: entry.genres,
    runtimeMinutes: entry.runtimeMinutes,
    pageCount: entry.pageCount,
    seasonCount: entry.seasonCount,
    externalIds: entry.externalIds,
    whereToWatch: entry.streaming.length ? entry.streaming.slice(0, 3).join(", ") : row.whereToWatch ?? null,
    ...list,
  };
}
