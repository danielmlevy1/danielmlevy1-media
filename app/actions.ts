"use server";

/**
 * Server actions for the list UI. Each one checks the session and goes
 * through the write cores in lib/media/item-write.ts, same as the assistant.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/firebase/session";
import { getItem } from "@/lib/firestore/data";
import {
  archiveItemRecord,
  createItemRecord,
  restoreItemRecord,
  updateItemRecord,
  type ItemChanges,
} from "@/lib/media/item-write";
import { entryToInput, fetchDetails, LookupError, type CatalogRef } from "@/lib/lookup/catalog";
import { MEDIA_STATUSES, MEDIA_TYPES, type MediaStatus, type MediaType } from "@/lib/firestore/types";

type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

async function uid(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user.uid;
}

const text = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const int = (f: FormData, k: string) => {
  const v = text(f, k);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const statusOf = (v: unknown): MediaStatus | undefined =>
  MEDIA_STATUSES.includes(v as MediaStatus) ? (v as MediaStatus) : undefined;

const changedOr = (v: string | null, cur: string | null) => (v === cur ? undefined : v);

function refresh(id?: string) {
  revalidatePath("/list");
  revalidatePath("/trash");
  if (id) revalidatePath(`/item/${id}`);
}

/** Add a search result. Extras are what the user set on the add screen. */
export async function addFromCatalog(
  ref: CatalogRef,
  extras: { status?: string; recommendedBy?: string },
): Promise<ActionResult> {
  const u = await uid();
  try {
    const entry = await fetchDetails(ref);
    const r = await createItemRecord(u, {
      ...entryToInput(entry),
      status: statusOf(extras.status) ?? "want",
      recommendedBy: extras.recommendedBy?.trim() || null,
    });
    if (!r.ok) return { ok: false, error: r.errors.join(" ") };
    refresh();
    return { ok: true, id: r.id };
  } catch (e) {
    return { ok: false, error: e instanceof LookupError ? e.message : "Couldn't add that." };
  }
}

/** Add by typing a title (no catalog match, or no TMDB key yet). */
export async function addManual(form: FormData): Promise<ActionResult> {
  const u = await uid();
  const type = text(form, "type") as MediaType;
  if (!MEDIA_TYPES.includes(type)) return { ok: false, error: "Pick movie, show or book." };
  const year = int(form, "year");
  if (Number.isNaN(year)) return { ok: false, error: "Year must be a number." };
  const r = await createItemRecord(u, {
    type,
    title: text(form, "title") ?? "",
    year,
    creator: text(form, "creator"),
    status: statusOf(text(form, "status")) ?? "want",
    recommendedBy: text(form, "recommendedBy"),
    whereToWatch: text(form, "whereToWatch"),
  });
  if (!r.ok) return { ok: false, error: r.errors.join(" ") };
  refresh();
  return { ok: true, id: r.id };
}

/** The edit form on the item page. */
export async function saveItem(id: string, form: FormData): Promise<ActionResult> {
  const u = await uid();
  const item = await getItem(u, id);
  if (!item) return { ok: false, error: "That item doesn't exist." };
  const changes: ItemChanges = {
    status: statusOf(text(form, "status")),
    rating: int(form, "rating"),
    notes: text(form, "notes"),
    recommendedBy: text(form, "recommendedBy"),
    whereToWatch: text(form, "whereToWatch"),
    tags: (text(form, "tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    // Only send a date the user actually changed, so a status change can
    // still stamp today's date on an empty one.
    startedAt: changedOr(text(form, "startedAt"), item.startedAt),
    finishedAt: changedOr(text(form, "finishedAt"), item.finishedAt),
  };
  if (item.type !== "movie") {
    const keys = item.type === "show" ? (["season", "episode"] as const) : (["page", "percent"] as const);
    const p: Record<string, number> = {};
    for (const k of keys) {
      const v = int(form, k);
      if (Number.isNaN(v)) return { ok: false, error: `${k} must be a number.` };
      if (v !== null) p[k] = v;
    }
    changes.progress = Object.keys(p).length ? p : null;
  }
  const r = await updateItemRecord(u, id, changes);
  if (!r.ok) return { ok: false, error: r.errors.join(" ") };
  refresh(id);
  return { ok: true, id };
}

/** One-tap buttons on list cards: start, next episode, finished. */
export async function quickAction(form: FormData): Promise<void> {
  const u = await uid();
  const id = text(form, "id");
  const action = text(form, "action");
  if (!id) return;
  const item = await getItem(u, id);
  if (!item || item.archivedAt) return;
  let changes: ItemChanges | null = null;
  if (action === "start") changes = { status: "in_progress" };
  if (action === "finish") changes = { status: "finished" };
  if (action === "next_episode" && item.type === "show") {
    const p = item.progress ?? {};
    changes = { progress: { season: p.season ?? 1, episode: (p.episode ?? 0) + 1 } };
  }
  if (changes) await updateItemRecord(u, id, changes);
  refresh(id);
}

export async function archiveItem(id: string): Promise<void> {
  const u = await uid();
  await archiveItemRecord(u, id);
  refresh(id);
  redirect("/list");
}

export async function restoreItem(form: FormData): Promise<void> {
  const u = await uid();
  const id = text(form, "id");
  if (id) await restoreItemRecord(u, id);
  refresh(id ?? undefined);
}
