"use client";

import { useState, useTransition } from "react";
import { archiveItem, saveItem } from "@/app/actions";
import { STATUS_LABEL } from "@/lib/media/labels";
import { MEDIA_STATUSES, type MediaItem } from "@/lib/firestore/types";

export default function ItemForm({ item }: { item: MediaItem }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rating, setRating] = useState<number | null>(item.rating);

  function submit(form: FormData) {
    form.set("rating", rating ? String(rating) : "");
    start(async () => {
      const r = await saveItem(item.id, form);
      setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
    });
  }

  const label = "mb-1 block text-xs text-secondary";
  return (
    <form action={submit} className="mt-8 space-y-4 rounded-card border border-border bg-surface p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Status</span>
          <select name="status" defaultValue={item.status} className="input">
            {MEDIA_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <div>
          <span className={label}>Rating</span>
          <div className="flex items-center gap-1 py-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`${n} star${n > 1 ? "s" : ""}`}
                onClick={() => setRating(rating === n ? null : n)}
                className={`text-xl leading-none ${rating && n <= rating ? "text-warn" : "text-muted hover:text-secondary"}`}
              >
                ★
              </button>
            ))}
            {rating && <button type="button" onClick={() => setRating(null)} className="ml-2 text-xs text-muted hover:text-secondary">Clear</button>}
          </div>
        </div>
      </div>

      {item.type === "show" && (
        <div className="grid grid-cols-2 gap-4">
          <label className="block"><span className={label}>Season</span><input name="season" inputMode="numeric" defaultValue={item.progress?.season ?? ""} className="input" /></label>
          <label className="block"><span className={label}>Last episode watched</span><input name="episode" inputMode="numeric" defaultValue={item.progress?.episode ?? ""} className="input" /></label>
        </div>
      )}
      {item.type === "book" && (
        <div className="grid grid-cols-2 gap-4">
          <label className="block"><span className={label}>Page</span><input name="page" inputMode="numeric" defaultValue={item.progress?.page ?? ""} className="input" /></label>
          <label className="block"><span className={label}>Or percent</span><input name="percent" inputMode="decimal" defaultValue={item.progress?.percent ?? ""} className="input" /></label>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className={label}>Recommended by</span><input name="recommendedBy" defaultValue={item.recommendedBy ?? ""} className="input" /></label>
        <label className="block"><span className={label}>{item.type === "book" ? "Where to read" : "Where to watch"}</span><input name="whereToWatch" defaultValue={item.whereToWatch ?? ""} className="input" /></label>
        <label className="block"><span className={label}>Started</span><input type="date" name="startedAt" defaultValue={item.startedAt ?? ""} className="input" /></label>
        <label className="block"><span className={label}>Finished</span><input type="date" name="finishedAt" defaultValue={item.finishedAt ?? ""} className="input" /></label>
      </div>
      <label className="block"><span className={label}>Tags (comma separated)</span><input name="tags" defaultValue={item.tags.join(", ")} className="input" /></label>
      <label className="block"><span className={label}>Notes</span><textarea name="notes" rows={3} defaultValue={item.notes ?? ""} className="input" /></label>

      {msg && <p className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
      <div className="flex items-center justify-between gap-3">
        <button type="submit" disabled={pending} className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={pending} onClick={() => start(() => archiveItem(item.id))} className="text-sm text-secondary hover:text-danger">
          Move to trash
        </button>
      </div>
    </form>
  );
}
