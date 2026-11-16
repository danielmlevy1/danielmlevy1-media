/**
 * Media tools for the suite assistant (v2). The proxy's assistant reaches this
 * app ONLY through these tools; the manifest it sees is generated from the
 * schemas and descriptions here, so nothing is hand-written in the registry.
 *
 * Every write goes through `lib/media/item-write.ts` and keeps its rules
 * (status date stamps, progress fitting the type, 1–5 ratings, no duplicates,
 * delete = archive). Summaries on the confirm card come from `propose`, never
 * from the model.
 *
 * Undo: every write names its inverse. add ↔ archive, archive ↔ restore, and
 * updates put back the old values (`before` from the write core).
 */

import { z } from "zod";
import { defineTool, ToolError, type AnyTool } from "@daniellevy/assistant-kit";
import { getArchivedItems, getItem, getItems } from "@/lib/firestore/data";
import {
  archiveItemRecord,
  createItemRecord,
  findDuplicate,
  localToday,
  planChanges,
  planNewItem,
  restoreItemRecord,
  STATUS_LABEL,
  TYPE_LABEL,
  updateItemRecord,
  type ItemChanges,
  type NewItemInput,
} from "@/lib/media/item-write";
import { entryToInput, fetchDetails, imdbUrl, LookupError, searchCatalog } from "@/lib/lookup/catalog";
import type { MediaItem } from "@/lib/firestore/types";
import { progressLabel } from "@/lib/media/labels";

// -----------------------------------------------------------------------------
// Shared schemas and helpers
// -----------------------------------------------------------------------------

const itemId = z.string().min(1).describe("Item id, from search_list or get_item. Never invent one.");
const type = z.enum(["movie", "show", "book"]);
const status = z.enum(["want", "in_progress", "finished", "dropped"]).describe("want = on the to-watch/to-read list; in_progress = watching/reading now; finished; dropped = gave up.");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const rating = z.number().int().min(1).max(5).describe("Whole stars, 1 to 5.");
const progress = z
  .object({
    season: z.number().int().min(1).optional(),
    episode: z.number().int().min(0).optional(),
    page: z.number().int().min(0).optional(),
    percent: z.number().min(0).max(100).optional(),
  })
  .describe("Shows: season + episode (the last one watched). Books: page or percent. Movies have no progress.");

const externalIds = z.object({
  tmdb: z.number().int().optional(),
  tvmaze: z.number().int().optional(),
  imdb: z.string().optional(),
  openLibrary: z.string().optional(),
  isbn: z.string().optional(),
});

const catalogRef = z
  .object({ source: z.enum(["tmdb", "tvmaze", "openlibrary"]), id: z.string().min(1), type })
  .describe("The `ref` of a lookup_title result. Fills in poster, year, genres, runtime and IMDb id.");

function writeFailed(errors: string[] | string | undefined): never {
  throw new ToolError(Array.isArray(errors) ? errors.join(" ") : errors || "That didn't save.");
}

async function liveItem(uid: string, id: string): Promise<MediaItem> {
  const i = await getItem(uid, id);
  if (!i || i.archivedAt) throw new ToolError("That item doesn't exist (or is in the trash).");
  return i;
}

const yearBit = (y: number | null | undefined) => (y ? ` (${y})` : "");

function brief(i: MediaItem) {
  return {
    id: i.id,
    type: i.type,
    title: i.title,
    year: i.year ?? undefined,
    status: i.status,
    progress: progressLabel(i.type, i.progress) ?? undefined,
    rating: i.rating ?? undefined,
    runtimeMinutes: i.runtimeMinutes ?? undefined,
    genres: i.genres.length ? i.genres : undefined,
    recommendedBy: i.recommendedBy ?? undefined,
    whereToWatch: i.whereToWatch ?? undefined,
    finishedAt: i.finishedAt ?? undefined,
  };
}

const CHANGE_LABEL: Record<keyof ItemChanges, string> = {
  title: "title",
  year: "year",
  creator: "creator",
  posterUrl: "poster",
  status: "status",
  progress: "progress",
  rating: "rating",
  notes: "notes",
  recommendedBy: "recommended by",
  whereToWatch: "where to watch",
  tags: "tags",
  startedAt: "started date",
  finishedAt: "finished date",
};

/** "status → Finished, rating 4/5, notes" — what an update changes, for the card. */
function describePatch(item: MediaItem, patch: Partial<MediaItem>): string {
  const bits: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === "status") bits.push(`status → ${STATUS_LABEL[v as MediaItem["status"]]}`);
    else if (k === "rating") bits.push(v === null ? "clear rating" : `rating ${v}/5`);
    else if (k === "progress") bits.push(v === null ? "clear progress" : `at ${progressLabel(item.type, v as MediaItem["progress"])}`);
    else if (k === "startedAt" || k === "finishedAt") continue; // stamped by the status rules
    else bits.push(v === null || v === "" ? `clear ${CHANGE_LABEL[k as keyof ItemChanges]}` : CHANGE_LABEL[k as keyof ItemChanges]);
  }
  if (!bits.length && (patch.startedAt !== undefined || patch.finishedAt !== undefined)) bits.push("dates");
  return bits.join(", ");
}

/** Plan an update against live data; refuse a no-op. */
async function planUpdate(uid: string, id: string, changes: ItemChanges) {
  const item = await liveItem(uid, id);
  const plan = planChanges(item, changes, localToday());
  if (!plan.ok) writeFailed(plan.errors);
  if (!Object.keys(plan.patch).length) throw new ToolError("Nothing to change.");
  return { item, patch: plan.patch };
}

/** Run an update; returns `before` so Undo can put the old values back. */
async function runUpdate(uid: string, id: string, changes: ItemChanges) {
  const r = await updateItemRecord(uid, id, changes);
  if (!r.ok) writeFailed(r.errors);
  return { itemId: id, before: r.before as ItemChanges };
}

const undoUpdate = (_ctx: unknown, _input: unknown, result: { itemId: string; before: ItemChanges }) =>
  Object.keys(result.before).length ? { tool: "update_item", input: { itemId: result.itemId, ...result.before } } : null;

// -----------------------------------------------------------------------------
// Read tools
// -----------------------------------------------------------------------------

const searchList = defineTool({
  name: "search_list",
  kind: "read",
  description:
    "Search the user's watch/read list (trash excluded): movies, shows and books with their status, progress, rating, who recommended them and where to watch. Use for 'what's on my list', 'what should I watch tonight' (status want, a type, maxMinutes), 'what am I reading', 'what did Joey recommend', 'what did I rate 5 stars', and to find an id before any write. Also returns counts by status.",
  input: z.object({
    query: z.string().optional().describe("Words matched against title, creator, genres, tags, notes and recommended-by."),
    type: type.optional(),
    status: status.optional(),
    recommendedBy: z.string().optional().describe("Only items recommended by this person (case-insensitive substring)."),
    maxMinutes: z.number().int().positive().optional().describe("Movies only: runtime at most this many minutes."),
    minRating: z.number().int().min(1).max(5).optional(),
    limit: z.number().int().min(1).max(100).optional().describe("Default 30."),
  }),
  probe: { limit: 1 },
  async run({ uid }, input) {
    const all = await getItems(uid);
    const words = (input.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const rec = input.recommendedBy?.toLowerCase();
    const matches = all.filter((i) => {
      if (input.type && i.type !== input.type) return false;
      if (input.status && i.status !== input.status) return false;
      if (rec && !(i.recommendedBy ?? "").toLowerCase().includes(rec)) return false;
      if (input.maxMinutes && (i.type !== "movie" || !i.runtimeMinutes || i.runtimeMinutes > input.maxMinutes)) return false;
      if (input.minRating && (i.rating ?? 0) < input.minRating) return false;
      if (!words.length) return true;
      const hay = [i.title, i.creator, i.notes, i.recommendedBy, i.whereToWatch, ...i.genres, ...i.tags].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const counts = { want: 0, in_progress: 0, finished: 0, dropped: 0 };
    for (const i of all) counts[i.status]++;
    return { total: matches.length, counts, items: matches.slice(0, input.limit ?? 30).map(brief) };
  },
});

const getItemTool = defineTool({
  name: "get_item",
  kind: "read",
  description: "One list item in full: overview, creator (director/author/network), genres, runtime, seasons or pages, progress, rating, notes, dates, and its IMDb link.",
  input: z.object({ itemId }),
  async run({ uid }, { itemId: id }) {
    const i = await liveItem(uid, id);
    return { ...i, imdbUrl: imdbUrl(i.externalIds) ?? undefined, progressLabel: progressLabel(i.type, i.progress) ?? undefined };
  },
});

const listTrash = defineTool({
  name: "list_trashed_items",
  kind: "read",
  description: "Items in the trash, newest first. Use to find the id for restore_item.",
  input: z.object({}),
  async run({ uid }) {
    return (await getArchivedItems(uid)).map((i) => ({ id: i.id, type: i.type, title: i.title, archivedAt: i.archivedAt }));
  },
});

const lookupTitle = defineTool({
  name: "lookup_title",
  kind: "read",
  description:
    "Look a title up in the public catalogs (TMDB for movies and shows, Open Library for books) before adding it. Returns candidates with year, creator, overview and a `ref`; pick the one the user means (ask if it's ambiguous) and pass its `ref` to add_to_list. Also says if a candidate is already on the list.",
  input: z.object({ type, query: z.string().min(1).describe("The title, optionally with a year or author.") }),
  async run({ uid }, input) {
    let found;
    try {
      found = await searchCatalog(input.type, input.query, { limit: 6 });
    } catch (e) {
      throw new ToolError(e instanceof LookupError ? e.message : "The title search failed.");
    }
    const mine = await getItems(uid);
    return found.map((c) => {
      const dup = findDuplicate(mine, c);
      return {
        ref: c.ref,
        title: c.title,
        year: c.year ?? undefined,
        creator: c.creator ?? undefined,
        overview: c.overview ? c.overview.slice(0, 240) : undefined,
        alreadyOnList: dup ? { itemId: dup.id, status: dup.status } : undefined,
      };
    });
  },
});

// -----------------------------------------------------------------------------
// Write tools
// -----------------------------------------------------------------------------

const addInput = z.object({
  type,
  title: z.string().optional().describe("Required unless catalogRef is given."),
  catalogRef: catalogRef.optional(),
  status: status.optional().describe("Default want."),
  recommendedBy: z.string().optional().describe("Who suggested it, e.g. 'Joey'."),
  whereToWatch: z.string().optional().describe("e.g. 'Netflix', 'Kindle'. Filled from the catalog when known."),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  rating: rating.optional(),
  progress: progress.optional(),
  // Catalog fields: filled in by propose from catalogRef. Pass them only for a manual add.
  year: z.number().int().optional(),
  creator: z.string().optional(),
  overview: z.string().optional(),
  posterUrl: z.string().optional(),
  genres: z.array(z.string()).optional(),
  runtimeMinutes: z.number().int().positive().optional(),
  pageCount: z.number().int().positive().optional(),
  seasonCount: z.number().int().positive().optional(),
  externalIds: externalIds.optional(),
});
type AddInput = z.output<typeof addInput>;

/** Drop null/undefined/empty so the resolved input still parses. */
function defined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length) && !(typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length)),
  ) as Partial<T>;
}

function toNewItem(input: AddInput): NewItemInput {
  const { catalogRef: _ref, ...rest } = input;
  return { ...rest, title: rest.title ?? "" };
}

const addToList = defineTool({
  name: "add_to_list",
  kind: "write",
  description:
    "Add a movie, show or book to the list. Best: call lookup_title first and pass the chosen result's ref as catalogRef (fills poster, year, genres, runtime, IMDb id, where it streams). Without a match, give type + title. Default status is want; use in_progress or finished (with rating) if the user is already watching or has seen it. Refuses duplicates.",
  input: addInput,
  probe: { type: "movie", title: "Conformance probe" },
  async propose({ uid }, input) {
    let resolved: AddInput = input;
    if (input.catalogRef) {
      if (input.catalogRef.type !== input.type) throw new ToolError("That catalog result is a different type.");
      try {
        const entry = await fetchDetails(input.catalogRef);
        const { catalogRef: _ref, ...userFields } = input;
        resolved = { ...defined(entryToInput(entry)), ...defined(userFields) } as AddInput;
        resolved.title = input.title?.trim() ? input.title : entry.title;
      } catch (e) {
        throw new ToolError(e instanceof LookupError ? e.message : "Couldn't look that title up.");
      }
    }
    const plan = planNewItem(toNewItem(resolved), await getItems(uid), { id: "preview", now: "", today: localToday() });
    if (!plan.ok) writeFailed(plan.errors);
    const i = plan.item;
    const extra = [i.recommendedBy ? `from ${i.recommendedBy}` : null, i.rating ? `${i.rating}/5` : null].filter(Boolean).join(", ");
    return {
      summary: `Add “${i.title}”${yearBit(i.year)} (${TYPE_LABEL[i.type].toLowerCase()}) to ${STATUS_LABEL[i.status]}${extra ? `, ${extra}` : ""}`,
      input: resolved,
      preview: { creator: i.creator, posterUrl: i.posterUrl, genres: i.genres, whereToWatch: i.whereToWatch },
    };
  },
  async run({ uid }, input) {
    const r = await createItemRecord(uid, toNewItem(input));
    if (!r.ok) writeFailed(r.errors);
    return { itemId: r.id, message: `Added “${input.title}”.` };
  },
  undo: (_ctx, _input, result) => ({ tool: "archive_item", input: { itemId: result.itemId } }),
});

const updateInput = z.object({
  itemId,
  title: z.string().min(1).optional(),
  year: z.number().int().nullable().optional(),
  creator: z.string().nullable().optional(),
  posterUrl: z.string().nullable().optional(),
  status: status.optional(),
  progress: progress.nullable().optional(),
  rating: rating.nullable().optional(),
  notes: z.string().nullable().optional().describe("Replaces the notes. null clears."),
  recommendedBy: z.string().nullable().optional(),
  whereToWatch: z.string().nullable().optional(),
  tags: z.array(z.string()).optional().describe("The complete new list."),
  startedAt: date.nullable().optional(),
  finishedAt: date.nullable().optional(),
});

const updateItem = defineTool({
  name: "update_item",
  kind: "write",
  description:
    "Change fields on a list item: status, rating, notes, who recommended it, where to watch, tags, dates, title. Only the fields given change; null clears one. Moving to in_progress or finished stamps today's date unless one is given. For progress use set_progress; for finishing use mark_finished.",
  input: updateInput,
  async propose({ uid }, { itemId: id, ...changes }) {
    const { item, patch } = await planUpdate(uid, id, changes);
    return { summary: `Update “${item.title}”: ${describePatch(item, patch)}` };
  },
  run: ({ uid }, { itemId: id, ...changes }) => runUpdate(uid, id, changes),
  undo: undoUpdate,
});

const setProgress = defineTool({
  name: "set_progress",
  kind: "write",
  description:
    "Record how far the user is: for a show the season and episode they last watched ('I'm on S2E4' → season 2, episode 4), for a book the page or percent. Moves an item still on 'want' to in_progress.",
  input: z.object({
    itemId,
    season: z.number().int().min(1).optional(),
    episode: z.number().int().min(0).optional(),
    page: z.number().int().min(0).optional(),
    percent: z.number().min(0).max(100).optional(),
  }),
  async propose({ uid }, { itemId: id, ...p }) {
    if (!Object.keys(p).length) throw new ToolError("Say how far: season and episode, or a page or percent.");
    const { item, patch } = await planUpdate(uid, id, { progress: p });
    const where = progressLabel(item.type, (patch.progress ?? item.progress) as MediaItem["progress"]);
    const moved = patch.status ? ` (now ${STATUS_LABEL[patch.status].toLowerCase()})` : "";
    return { summary: `Mark “${item.title}” at ${where}${moved}` };
  },
  run: ({ uid }, { itemId: id, ...p }) => runUpdate(uid, id, { progress: p }),
  undo: undoUpdate,
});

const markFinished = defineTool({
  name: "mark_finished",
  kind: "write",
  description: "Mark an item finished (watched or read), optionally with a 1–5 rating, a note, and the date (default today).",
  input: z.object({ itemId, rating: rating.optional(), notes: z.string().optional().describe("Replaces the notes."), finishedAt: date.optional() }),
  async propose({ uid }, { itemId: id, ...rest }) {
    const { item } = await planUpdate(uid, id, { status: "finished", ...rest });
    return { summary: `Mark “${item.title}” finished${rest.rating ? ` (${rest.rating}/5)` : ""}` };
  },
  run: ({ uid }, { itemId: id, ...rest }) => runUpdate(uid, id, { status: "finished", ...rest }),
  undo: undoUpdate,
});

const archiveItem = defineTool({
  name: "archive_item",
  kind: "write",
  description: "Remove an item from the list. It goes to the trash and can be restored.",
  input: z.object({ itemId }),
  async propose({ uid }, { itemId: id }) {
    const i = await liveItem(uid, id);
    return { summary: `Move “${i.title}” to the trash` };
  },
  async run({ uid }, { itemId: id }) {
    const r = await archiveItemRecord(uid, id);
    if (!r.ok) writeFailed(r.errors);
    return { itemId: id };
  },
  undo: (_ctx, input) => ({ tool: "restore_item", input: { itemId: input.itemId } }),
});

const restoreItem = defineTool({
  name: "restore_item",
  kind: "write",
  description: "Bring an item back from the trash (id from list_trashed_items).",
  input: z.object({ itemId }),
  async propose({ uid }, { itemId: id }) {
    const i = await getItem(uid, id);
    if (!i || !i.archivedAt) throw new ToolError("That item isn't in the trash.");
    return { summary: `Restore “${i.title}” from the trash` };
  },
  async run({ uid }, { itemId: id }) {
    const r = await restoreItemRecord(uid, id);
    if (!r.ok) writeFailed(r.errors);
    return { itemId: id };
  },
  undo: (_ctx, input) => ({ tool: "archive_item", input: { itemId: input.itemId } }),
});

export const MEDIA_TOOLS: AnyTool[] = [
  searchList,
  getItemTool,
  listTrash,
  lookupTitle,
  addToList,
  updateItem,
  setProgress,
  markFinished,
  archiveItem,
  restoreItem,
];
