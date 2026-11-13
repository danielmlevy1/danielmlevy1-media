/**
 * The ONLY place md_items are written. Forms, the add-from-search flow and the
 * assistant tools all go through these, so validation and the status rules
 * can't drift:
 *
 *   - Moving to in_progress stamps `startedAt` (if empty); moving to finished
 *     stamps `finishedAt` (if empty). Dates are the user's local day.
 *   - Setting progress on something still on "want" moves it to in_progress.
 *   - Progress fields must fit the type: season/episode for shows,
 *     page/percent for books, none for movies.
 *   - Rating is a whole number 1–5, or null.
 *   - An item already on the list (same catalog id, or same type + title +
 *     year) can't be added again.
 *   - Delete = archive (`archivedAt`); nothing here hard-deletes.
 *
 * `planNewItem` and `planChanges` are pure, so the rules are unit-tested
 * without Firestore.
 */

import { randomUUID } from "node:crypto";
import { itemsCol, getItem, getItems } from "@/lib/firestore/data";
import {
  MEDIA_STATUSES,
  MEDIA_TYPES,
  type ExternalIds,
  type MediaItem,
  type MediaStatus,
  type MediaType,
  type Progress,
} from "@/lib/firestore/types";

const TZ = "America/New_York";

/** Today as YYYY-MM-DD in the user's time zone. */
export function localToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export { STATUS_LABEL, TYPE_LABEL } from "@/lib/media/labels";
import { STATUS_LABEL } from "@/lib/media/labels";

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

export interface NewItemInput {
  type: MediaType;
  title: string;
  year?: number | null;
  creator?: string | null;
  overview?: string | null;
  posterUrl?: string | null;
  genres?: string[];
  runtimeMinutes?: number | null;
  pageCount?: number | null;
  seasonCount?: number | null;
  externalIds?: ExternalIds;
  status?: MediaStatus;
  progress?: Progress | null;
  rating?: number | null;
  notes?: string | null;
  recommendedBy?: string | null;
  whereToWatch?: string | null;
  tags?: string[];
}

/** Fields a user (or the assistant) may change on an existing item. null clears. */
export interface ItemChanges {
  title?: string;
  year?: number | null;
  creator?: string | null;
  posterUrl?: string | null;
  status?: MediaStatus;
  progress?: Progress | null;
  rating?: number | null;
  notes?: string | null;
  recommendedBy?: string | null;
  whereToWatch?: string | null;
  tags?: string[];
  startedAt?: string | null;
  finishedAt?: string | null;
}

export const CHANGE_KEYS = [
  "title",
  "year",
  "creator",
  "posterUrl",
  "status",
  "progress",
  "rating",
  "notes",
  "recommendedBy",
  "whereToWatch",
  "tags",
  "startedAt",
  "finishedAt",
] as const satisfies readonly (keyof ItemChanges)[];

type Result = { ok: true; id: string } | { ok: false; errors: string[] };

// -----------------------------------------------------------------------------
// Validation helpers
// -----------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (s: string | null | undefined) => (typeof s === "string" && s.trim() ? s.trim() : null);
const cleanTags = (t: string[] | undefined) =>
  [...new Set((t ?? []).map((x) => x.trim()).filter(Boolean))];

/** Drop empty progress fields; null when nothing is left. */
export function cleanProgress(p: Progress | null | undefined): Progress | null {
  if (!p) return null;
  const out: Progress = {};
  for (const k of ["season", "episode", "page", "percent"] as const) {
    const v = p[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

function progressErrors(type: MediaType, p: Progress | null): string[] {
  if (!p) return [];
  const errors: string[] = [];
  const whole = (n: number | undefined, min: number) => n === undefined || (Number.isInteger(n) && n >= min);
  if (type === "movie") errors.push("Movies don't track progress; mark it finished instead.");
  if (type === "show") {
    if (p.page !== undefined || p.percent !== undefined) errors.push("Shows track season and episode, not pages.");
    if (!whole(p.season, 1) || !whole(p.episode, 0)) errors.push("Season and episode must be whole numbers (season from 1).");
  }
  if (type === "book") {
    if (p.season !== undefined || p.episode !== undefined) errors.push("Books track page or percent, not episodes.");
    if (!whole(p.page, 0)) errors.push("Page must be a whole number.");
    if (p.percent !== undefined && (p.percent < 0 || p.percent > 100)) errors.push("Percent must be between 0 and 100.");
  }
  return errors;
}

function ratingErrors(r: number | null | undefined): string[] {
  if (r === null || r === undefined) return [];
  return Number.isInteger(r) && r >= 1 && r <= 5 ? [] : ["Rating must be a whole number from 1 to 5."];
}

function dateErrors(label: string, d: string | null | undefined): string[] {
  if (d === null || d === undefined) return [];
  return DATE.test(d) ? [] : [`${label} must be YYYY-MM-DD.`];
}

/** Apply the status rules to a merged item: stamps dates and promotes want → in_progress. */
function applyStatusRules(next: MediaItem, prev: MediaItem | null, explicit: ItemChanges, today: string): MediaItem {
  const out = { ...next };
  const progressSet = explicit.progress !== undefined && out.progress !== null;
  if (progressSet && explicit.status === undefined && out.status === "want") out.status = "in_progress";
  const moved = !prev || prev.status !== out.status;
  if (moved && out.status === "in_progress" && !out.startedAt && explicit.startedAt === undefined) out.startedAt = today;
  if (moved && out.status === "finished" && !out.finishedAt && explicit.finishedAt === undefined) out.finishedAt = today;
  return out;
}

// -----------------------------------------------------------------------------
// Pure planners
// -----------------------------------------------------------------------------

/** Lowercased title with punctuation and leading articles dropped. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/^(the|a|an) /, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The live item a candidate would duplicate, if any. */
export function findDuplicate(
  items: MediaItem[],
  c: { type: MediaType; title: string; year?: number | null; externalIds?: ExternalIds },
): MediaItem | null {
  const ids = c.externalIds ?? {};
  for (const i of items) {
    if (i.archivedAt || i.type !== c.type) continue;
    const e = i.externalIds;
    if ((ids.tmdb && e.tmdb === ids.tmdb) || (ids.tvmaze && e.tvmaze === ids.tvmaze) || (ids.imdb && e.imdb === ids.imdb) || (ids.openLibrary && e.openLibrary === ids.openLibrary)) return i;
    if (titleKey(i.title) === titleKey(c.title) && (!c.year || !i.year || i.year === c.year)) return i;
  }
  return null;
}

/** Validate a new item and build the doc. */
export function planNewItem(input: NewItemInput, existing: MediaItem[], ctx: { id: string; now: string; today: string }):
  | { ok: true; item: MediaItem }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const title = clean(input.title);
  if (!title) errors.push("A title is required.");
  if (!MEDIA_TYPES.includes(input.type)) errors.push("Type must be movie, show or book.");
  const status = input.status ?? "want";
  if (!MEDIA_STATUSES.includes(status)) errors.push("Unknown status.");
  const progress = cleanProgress(input.progress);
  errors.push(...progressErrors(input.type, progress), ...ratingErrors(input.rating));
  if (errors.length) return { ok: false, errors };

  const dup = findDuplicate(existing, { type: input.type, title: title!, year: input.year, externalIds: input.externalIds });
  if (dup) return { ok: false, errors: [`“${dup.title}” is already on your list (${STATUS_LABEL[dup.status]}).`] };

  const base: MediaItem = {
    id: ctx.id,
    type: input.type,
    title: title!,
    year: input.year ?? null,
    creator: clean(input.creator),
    overview: clean(input.overview),
    posterUrl: clean(input.posterUrl),
    genres: cleanTags(input.genres),
    runtimeMinutes: input.runtimeMinutes ?? null,
    pageCount: input.pageCount ?? null,
    seasonCount: input.seasonCount ?? null,
    externalIds: input.externalIds ?? {},
    status,
    progress,
    rating: input.rating ?? null,
    notes: clean(input.notes),
    recommendedBy: clean(input.recommendedBy),
    whereToWatch: clean(input.whereToWatch),
    tags: cleanTags(input.tags),
    startedAt: null,
    finishedAt: null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    archivedAt: null,
  };
  return { ok: true, item: applyStatusRules(base, null, { status: input.status, progress }, ctx.today) };
}

/**
 * Merge changes into an item. Returns the fields that actually change
 * (`patch`) and their old values (`before`, which is what Undo puts back).
 */
export function planChanges(item: MediaItem, changes: ItemChanges, today: string):
  | { ok: true; patch: Partial<MediaItem>; before: Partial<MediaItem> }
  | { ok: false; errors: string[] } {
  const merged: MediaItem = { ...item };
  const errors: string[] = [];
  for (const k of CHANGE_KEYS) {
    if (changes[k] === undefined) continue;
    switch (k) {
      case "title": {
        const t = clean(changes.title);
        if (!t) errors.push("A title can't be empty.");
        else merged.title = t;
        break;
      }
      case "progress":
        merged.progress = cleanProgress(changes.progress);
        break;
      case "tags":
        merged.tags = cleanTags(changes.tags);
        break;
      case "status":
        if (!MEDIA_STATUSES.includes(changes.status!)) errors.push("Unknown status.");
        else merged.status = changes.status!;
        break;
      case "creator":
      case "posterUrl":
      case "notes":
      case "recommendedBy":
      case "whereToWatch":
        merged[k] = clean(changes[k]);
        break;
      default:
        (merged as unknown as Record<string, unknown>)[k] = changes[k];
    }
  }
  errors.push(
    ...progressErrors(item.type, changes.progress !== undefined ? merged.progress : null),
    ...ratingErrors(changes.rating),
    ...dateErrors("Started date", changes.startedAt),
    ...dateErrors("Finished date", changes.finishedAt),
  );
  if (errors.length) return { ok: false, errors };

  const next = applyStatusRules(merged, item, changes, today);
  const patch: Partial<MediaItem> = {};
  const before: Partial<MediaItem> = {};
  for (const k of CHANGE_KEYS) {
    if (JSON.stringify(next[k]) !== JSON.stringify(item[k])) {
      (patch as Record<string, unknown>)[k] = next[k];
      (before as Record<string, unknown>)[k] = item[k];
    }
  }
  return { ok: true, patch, before };
}

// -----------------------------------------------------------------------------
// Firestore writes
// -----------------------------------------------------------------------------

export async function createItemRecord(uid: string, input: NewItemInput): Promise<Result> {
  const now = new Date();
  const plan = planNewItem(input, await getItems(uid), { id: randomUUID(), now: now.toISOString(), today: localToday(now) });
  if (!plan.ok) return plan;
  const { id, ...doc } = plan.item;
  await itemsCol(uid).doc(id).create(doc);
  return { ok: true, id };
}

export async function updateItemRecord(uid: string, id: string, changes: ItemChanges):
  Promise<{ ok: true; id: string; patch: Partial<MediaItem>; before: Partial<MediaItem> } | { ok: false; errors: string[] }> {
  const item = await getItem(uid, id);
  if (!item || item.archivedAt) return { ok: false, errors: ["That item doesn't exist (or is in the trash)."] };
  const now = new Date();
  const plan = planChanges(item, changes, localToday(now));
  if (!plan.ok) return plan;
  if (Object.keys(plan.patch).length) {
    await itemsCol(uid).doc(id).update({ ...plan.patch, updatedAt: now.toISOString() });
  }
  return { ok: true, id, patch: plan.patch, before: plan.before };
}

export async function archiveItemRecord(uid: string, id: string): Promise<Result> {
  const item = await getItem(uid, id);
  if (!item || item.archivedAt) return { ok: false, errors: ["That item doesn't exist (or is already in the trash)."] };
  const now = new Date().toISOString();
  await itemsCol(uid).doc(id).update({ archivedAt: now, updatedAt: now });
  return { ok: true, id };
}

export async function restoreItemRecord(uid: string, id: string): Promise<Result> {
  const item = await getItem(uid, id);
  if (!item || !item.archivedAt) return { ok: false, errors: ["That item isn't in the trash."] };
  const dup = findDuplicate(await getItems(uid), item);
  if (dup) return { ok: false, errors: [`“${dup.title}” is already back on your list.`] };
  await itemsCol(uid).doc(id).update({ archivedAt: null, updatedAt: new Date().toISOString() });
  return { ok: true, id };
}
