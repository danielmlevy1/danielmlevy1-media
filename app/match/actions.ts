"use server";

/**
 * Find covers: match items that were added by hand (no catalog id) to a
 * catalog entry, then fill in their poster, year, ids and details. Same
 * shape as import: preview first, then apply only what the user ticked.
 * The chosen match is re-fetched by ref here, never taken from the client.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/firebase/session";
import { getItems } from "@/lib/firestore/data";
import type { MediaItem } from "@/lib/firestore/types";
import { attachCatalogRecord } from "@/lib/media/item-write";
import { pickMatch } from "@/lib/media/import";
import { fetchDetails, hasTmdbKey, LookupError, searchCatalog, type CatalogEntry } from "@/lib/lookup/catalog";

const CHUNK = 8;

async function uid(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user.uid;
}

export interface MatchPreview {
  id: string;
  match: CatalogEntry | null;
  note: string | null;
}

async function findMatch(item: MediaItem): Promise<CatalogEntry | null> {
  const want = { title: item.title, year: item.year, creator: item.creator };
  // Books: title + author narrows Open Library a lot; fall back to the title alone.
  if (item.type === "book" && item.creator) {
    const m = pickMatch(want, await searchCatalog("book", `${item.title} ${item.creator}`, { limit: 8 }));
    if (m) return m;
  }
  return pickMatch(want, await searchCatalog(item.type, item.title, { limit: 8 }));
}

export async function previewMatches(ids: unknown): Promise<{ ok: true; rows: MatchPreview[] } | { ok: false; error: string }> {
  const u = await uid();
  const parsed = z.array(z.string().min(1)).max(CHUNK).safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Bad request." };
  const items = await getItems(u);
  const rows = await Promise.all(
    parsed.data.map(async (id): Promise<MatchPreview> => {
      const item = items.find((i) => i.id === id);
      if (!item) return { id, match: null, note: "Not on your list any more." };
      if (item.type === "movie" && !hasTmdbKey()) return { id, match: null, note: "Movie lookup needs the TMDB key." };
      try {
        const match = await findMatch(item);
        return { id, match, note: match ? null : "No good match found." };
      } catch (e) {
        return { id, match: null, note: e instanceof LookupError ? e.message : "Lookup failed." };
      }
    }),
  );
  return { ok: true, rows };
}

const ApplySchema = z
  .array(z.object({ id: z.string().min(1), ref: z.object({ source: z.enum(["tmdb", "tvmaze", "openlibrary"]), id: z.string().min(1), type: z.enum(["movie", "show", "book"]) }) }))
  .max(CHUNK);

export type ApplyResult = { id: string; ok: true } | { id: string; ok: false; error: string };

export async function applyMatches(input: unknown): Promise<{ ok: true; results: ApplyResult[] } | { ok: false; error: string }> {
  const u = await uid();
  const parsed = ApplySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad request." };
  const results: ApplyResult[] = [];
  for (const { id, ref } of parsed.data) {
    try {
      const e = await fetchDetails(ref);
      const r = await attachCatalogRecord(u, id, {
        year: e.year,
        creator: e.creator,
        overview: e.overview,
        posterUrl: e.posterUrl,
        genres: e.genres,
        runtimeMinutes: e.runtimeMinutes,
        pageCount: e.pageCount,
        seasonCount: e.seasonCount,
        externalIds: e.externalIds,
      });
      results.push(r.ok ? { id, ok: true } : { id, ok: false, error: r.errors.join(" ") });
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof LookupError ? err.message : "Couldn't fetch the details." });
    }
  }
  revalidatePath("/list");
  return { ok: true, results };
}
