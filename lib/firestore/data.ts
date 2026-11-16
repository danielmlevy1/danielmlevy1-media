/**
 * Every read of md_items goes through `normalizeItem`. Never cast
 * `d.data() as MediaItem`: a doc written by something other than this app's
 * write core (an envelope from the generic proxy, a hand edit) must not break
 * every page that lists items.
 */

import { adminDb } from "@/lib/firebase/admin";
import { ITEMS, USERS } from "@/lib/firestore/paths";
import {
  MEDIA_STATUSES,
  MEDIA_TYPES,
  type ExternalIds,
  type MediaItem,
  type MediaStatus,
  type MediaType,
  type Progress,
} from "@/lib/firestore/types";

export function itemsCol(uid: string) {
  return adminDb().collection(USERS).doc(uid).collection(ITEMS);
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);

function progressOf(v: unknown): Progress | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const p: Progress = {};
  for (const k of ["season", "episode", "page", "percent"] as const) {
    const n = num(o[k]);
    if (n !== null) p[k] = n;
  }
  return Object.keys(p).length ? p : null;
}

function externalIdsOf(v: unknown): ExternalIds {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const out: ExternalIds = {};
  const tmdb = num(o.tmdb);
  const tvmaze = num(o.tvmaze);
  if (tmdb !== null) out.tmdb = tmdb;
  if (tvmaze !== null) out.tvmaze = tvmaze;
  for (const k of ["imdb", "openLibrary", "isbn"] as const) {
    const s = str(o[k]);
    if (s) out[k] = s;
  }
  return out;
}

/** Coerce any md_items doc into a MediaItem. Unwraps a `{ data: {...} }` envelope. */
export function normalizeItem(id: string, raw: unknown): MediaItem {
  let d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (d.data && typeof d.data === "object" && !d.title) d = { ...(d.data as Record<string, unknown>), ...d, data: undefined };
  const type = MEDIA_TYPES.includes(d.type as MediaType) ? (d.type as MediaType) : "movie";
  const status = MEDIA_STATUSES.includes(d.status as MediaStatus) ? (d.status as MediaStatus) : "want";
  return {
    id,
    type,
    title: str(d.title) ?? "Untitled",
    year: num(d.year),
    creator: str(d.creator),
    overview: str(d.overview),
    posterUrl: str(d.posterUrl),
    genres: strs(d.genres),
    runtimeMinutes: num(d.runtimeMinutes),
    pageCount: num(d.pageCount),
    seasonCount: num(d.seasonCount),
    externalIds: externalIdsOf(d.externalIds),
    status,
    progress: progressOf(d.progress),
    rating: num(d.rating),
    notes: str(d.notes),
    recommendedBy: str(d.recommendedBy),
    whereToWatch: str(d.whereToWatch),
    tags: strs(d.tags),
    startedAt: str(d.startedAt),
    finishedAt: str(d.finishedAt),
    createdAt: str(d.createdAt) ?? "",
    updatedAt: str(d.updatedAt) ?? "",
    archivedAt: str(d.archivedAt),
  };
}

/** Live (not archived) items, newest first. */
export async function getItems(uid: string): Promise<MediaItem[]> {
  const snap = await itemsCol(uid).get();
  return snap.docs
    .map((d) => normalizeItem(d.id, d.data()))
    .filter((i) => !i.archivedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Archived items, most recently archived first. */
export async function getArchivedItems(uid: string): Promise<MediaItem[]> {
  const snap = await itemsCol(uid).get();
  return snap.docs
    .map((d) => normalizeItem(d.id, d.data()))
    .filter((i) => i.archivedAt)
    .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
}

/** One item, archived or not; null when missing. */
export async function getItem(uid: string, id: string): Promise<MediaItem | null> {
  const doc = await itemsCol(uid).doc(id).get();
  return doc.exists ? normalizeItem(doc.id, doc.data()) : null;
}
