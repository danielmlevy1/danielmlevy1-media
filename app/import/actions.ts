"use server";

/**
 * Bulk import (see lib/media/import.ts). The client sends rows in small
 * chunks so no single call runs long. Every row is re-validated here, and a
 * chosen match is re-fetched by its ref: nothing from the client is saved as-is.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/firebase/session";
import { getItems } from "@/lib/firestore/data";
import { createItemRecord, findDuplicate } from "@/lib/media/item-write";
import { ImportRowSchema, importInput, pickMatch, type ImportRow } from "@/lib/media/import";
import { fetchDetails, hasTmdbKey, LookupError, searchCatalog, type CatalogEntry } from "@/lib/lookup/catalog";

const CHUNK = 12;

async function uid(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user.uid;
}

export interface PreviewRow {
  row: ImportRow;
  match: CatalogEntry | null;
  /** Title of the live item this would duplicate. */
  onList: string | null;
  note: string | null;
}

export async function previewImport(input: unknown[]): Promise<{ ok: true; rows: PreviewRow[] } | { ok: false; error: string }> {
  const u = await uid();
  const parsed = z.array(ImportRowSchema).max(CHUNK).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Some items aren't in the expected shape." };
  const existing = await getItems(u);
  const rows = await Promise.all(
    parsed.data.map(async (row): Promise<PreviewRow> => {
      let match: CatalogEntry | null = null;
      let note: string | null = null;
      if (row.type === "movie" && !hasTmdbKey()) {
        note = "No movie lookup yet (TMDB key missing): adds as typed.";
      } else {
        try {
          match = pickMatch(row, await searchCatalog(row.type, row.title, { limit: 8 }));
          if (!match) note = "No catalog match: adds as typed.";
        } catch (e) {
          note = e instanceof LookupError ? e.message : "Lookup failed: adds as typed.";
        }
      }
      const dup = findDuplicate(existing, {
        type: row.type,
        title: match?.title ?? row.title,
        year: match?.year ?? row.year,
        externalIds: match?.externalIds,
      });
      return { row, match, onList: dup?.title ?? null, note };
    }),
  );
  return { ok: true, rows };
}

const CommitSchema = z
  .array(
    z.object({
      row: ImportRowSchema,
      ref: z.object({ source: z.enum(["tmdb", "tvmaze", "openlibrary"]), id: z.string().min(1), type: z.enum(["movie", "show", "book"]) }).nullable(),
    }),
  )
  .max(CHUNK);

export type CommitResult = { title: string; ok: true; id: string } | { title: string; ok: false; error: string };

export async function commitImport(input: unknown): Promise<{ ok: true; results: CommitResult[] } | { ok: false; error: string }> {
  const u = await uid();
  const parsed = CommitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Some items aren't in the expected shape." };
  const results: CommitResult[] = [];
  // One at a time: each create re-reads the list, so duplicates inside the batch are caught too.
  for (const { row, ref } of parsed.data) {
    let entry: CatalogEntry | null = null;
    if (ref) {
      try {
        entry = await fetchDetails(ref);
      } catch {
        entry = null; // details failed: still add it, as typed
      }
    }
    const r = await createItemRecord(u, importInput(row, entry));
    results.push(r.ok ? { title: entry?.title ?? row.title, ok: true, id: r.id } : { title: row.title, ok: false, error: r.errors.join(" ") });
  }
  revalidatePath("/list");
  return { ok: true, results };
}
