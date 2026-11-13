"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api } from "@/lib/base-path";
import { addFromCatalog, addManual } from "@/app/actions";
import { STATUS_LABEL } from "@/lib/media/labels";
import type { CatalogEntry } from "@/lib/lookup/catalog";
import type { MediaStatus, MediaType } from "@/lib/firestore/types";

type Result = CatalogEntry & { onList: { id: string; status: MediaStatus } | null };

const TYPES: { id: MediaType; label: string }[] = [
  { id: "show", label: "📺 Show" },
  { id: "movie", label: "🎬 Movie" },
  { id: "book", label: "📚 Book" },
];

export default function AddClient({ moviesSearchable }: { moviesSearchable: boolean }) {
  const router = useRouter();
  const [type, setType] = useState<MediaType>("show");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<MediaStatus>("want");
  const [recommendedBy, setRecommendedBy] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [adding, startAdding] = useTransition();
  const [added, setAdded] = useState<Record<string, string>>({});
  const [manual, setManual] = useState(false);

  const canSearch = type !== "movie" || moviesSearchable;

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim() || !canSearch) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/lookup?type=${type}&q=${encodeURIComponent(query)}`));
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Search failed.");
      setResults(body.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  function add(r: Result) {
    startAdding(async () => {
      setError(null);
      const out = await addFromCatalog(r.ref, { status, recommendedBy });
      if (out.ok && out.id) setAdded((a) => ({ ...a, [`${r.ref.source}:${r.ref.id}`]: out.id! }));
      else if (!out.ok) setError(out.error);
    });
  }

  function addTyped(form: FormData) {
    startAdding(async () => {
      setError(null);
      form.set("type", type);
      form.set("status", status);
      form.set("recommendedBy", recommendedBy);
      const out = await addManual(form);
      if (out.ok && out.id) router.push(`/item/${out.id}`);
      else if (!out.ok) setError(out.error);
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-1 rounded-card border border-border p-1">
        {TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setType(t.id);
              setResults(null);
            }}
            className={`flex-1 rounded-card px-3 py-1.5 text-sm ${t.id === type ? "bg-surface-hover text-primary" : "text-secondary hover:text-primary"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-secondary">Add to</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as MediaStatus)} className="input">
            {(["want", "in_progress", "finished"] as MediaStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-secondary">Recommended by (optional)</span>
          <input value={recommendedBy} onChange={(e) => setRecommendedBy(e.target.value)} placeholder="e.g. Joey" className="input" />
        </label>
      </div>

      {canSearch && !manual ? (
        <form onSubmit={search} className="flex gap-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={type === "book" ? "Title or author" : "Title"}
            className="input"
          />
          <button type="submit" disabled={searching} className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
            {searching ? "Searching…" : "Search"}
          </button>
        </form>
      ) : null}

      {!canSearch && (
        <p className="rounded-card bg-warn/10 px-3 py-2 text-sm text-secondary">
          Movie search turns on once the TMDB key is set up. For now, type the movie below.
        </p>
      )}

      {error && <p className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {results && (
        <ul className="divide-y divide-border rounded-card border border-border">
          {results.length === 0 && <li className="px-4 py-6 text-center text-sm text-secondary">No matches. Try another spelling, or add it by hand below.</li>}
          {results.map((r) => {
            const key = `${r.ref.source}:${r.ref.id}`;
            const addedId = added[key];
            return (
              <li key={key} className="flex gap-3 p-3">
                <div className="w-14 shrink-0">
                  <div className="aspect-[2/3] overflow-hidden rounded-card bg-surface-hover">
                    {r.posterUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.posterUrl} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {r.title} {r.year ? <span className="font-normal text-muted">({r.year})</span> : null}
                  </div>
                  {r.creator && <div className="text-xs text-secondary">{r.creator}</div>}
                  {r.overview && <p className="mt-1 line-clamp-2 text-xs text-muted">{r.overview}</p>}
                </div>
                <div className="shrink-0 self-center">
                  {addedId || r.onList ? (
                    <Link href={`/item/${addedId || r.onList!.id}`} className="text-xs text-accent hover:underline">
                      {addedId ? "Added ✓" : `On your list (${STATUS_LABEL[r.onList!.status]})`}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled={adding}
                      onClick={() => add(r)}
                      className="rounded-pill border border-accent px-3 py-1 text-xs font-medium text-accent hover:bg-accent-soft disabled:opacity-60"
                    >
                      Add
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canSearch && (
        <button type="button" onClick={() => setManual((m) => !m)} className="text-sm text-accent hover:underline">
          {manual ? "Back to search" : "Can't find it? Add it by hand"}
        </button>
      )}

      {(manual || !canSearch) && (
        <form action={addTyped} className="space-y-3 rounded-card border border-border p-4">
          <input name="title" required placeholder="Title" defaultValue={query} className="input" />
          <div className="grid gap-3 sm:grid-cols-3">
            <input name="year" inputMode="numeric" placeholder="Year" className="input" />
            <input name="creator" placeholder={type === "book" ? "Author" : type === "show" ? "Network" : "Director"} className="input" />
            <input name="whereToWatch" placeholder={type === "book" ? "Kindle, library…" : "Netflix, HBO…"} className="input" />
          </div>
          <button type="submit" disabled={adding} className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
            {adding ? "Adding…" : "Add"}
          </button>
        </form>
      )}
    </div>
  );
}
