"use client";

import Link from "next/link";
import { useState } from "react";
import { applyMatches, previewMatches, type MatchPreview } from "@/app/match/actions";
import { Poster, TypeBadge } from "@/app/_components/media-bits";
import type { MediaType } from "@/lib/firestore/types";

const CHUNK = 8;

type Item = { id: string; type: MediaType; title: string; year: number | null; creator: string | null };
type Row = Item & { preview?: MatchPreview; selected: boolean; result?: string };

export default function MatchClient({ items }: { items: Item[] }) {
  const [rows, setRows] = useState<Row[]>(items.map((i) => ({ ...i, selected: false })));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [looked, setLooked] = useState(false);
  const [applied, setApplied] = useState<number | null>(null);

  async function lookUp() {
    setError(null);
    const out = new Map<string, MatchPreview>();
    for (let i = 0; i < items.length; i += CHUNK) {
      setBusy(`Looking up ${Math.min(i + CHUNK, items.length)} of ${items.length}…`);
      const r = await previewMatches(items.slice(i, i + CHUNK).map((x) => x.id));
      if (!r.ok) {
        setError(r.error);
        break;
      }
      r.rows.forEach((p) => out.set(p.id, p));
      setRows((rs) => rs.map((x) => (out.has(x.id) ? { ...x, preview: out.get(x.id), selected: !!out.get(x.id)?.match } : x)));
    }
    setBusy(null);
    setLooked(true);
  }

  async function apply() {
    const chosen = rows.filter((r) => r.selected && r.preview?.match);
    let ok = 0;
    for (let i = 0; i < chosen.length; i += CHUNK) {
      setBusy(`Saving ${Math.min(i + CHUNK, chosen.length)} of ${chosen.length}…`);
      const r = await applyMatches(chosen.slice(i, i + CHUNK).map((x) => ({ id: x.id, ref: x.preview!.match!.ref })));
      if (!r.ok) {
        setError(r.error);
        break;
      }
      ok += r.results.filter((x) => x.ok).length;
      const failed = new Map(r.results.filter((x) => !x.ok).map((x) => [x.id, (x as { error: string }).error]));
      setRows((rs) => rs.map((x) => (failed.has(x.id) ? { ...x, result: failed.get(x.id) } : x)));
    }
    setBusy(null);
    setApplied(ok);
  }

  if (!items.length) {
    return (
      <p className="text-sm text-secondary">
        Everything on your list already has a catalog match. <Link href="/list" className="text-accent hover:underline">Back to my list</Link>
      </p>
    );
  }

  if (applied !== null) {
    const failed = rows.filter((r) => r.result);
    return (
      <div className="space-y-3">
        <p className="text-sm">
          Updated <strong>{applied}</strong> {applied === 1 ? "item" : "items"}.
        </p>
        {failed.length > 0 && (
          <ul className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">
            {failed.map((f) => (
              <li key={f.id}>
                {f.title}: {f.result}
              </li>
            ))}
          </ul>
        )}
        <Link href="/list" className="text-sm text-accent hover:underline">
          Go to my list
        </Link>
      </div>
    );
  }

  const selected = rows.filter((r) => r.selected && r.preview?.match).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        {!looked ? (
          <button onClick={lookUp} disabled={!!busy} className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
            {busy ?? `Look up ${items.length} ${items.length === 1 ? "item" : "items"}`}
          </button>
        ) : (
          <button onClick={apply} disabled={!!busy || selected === 0} className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
            {busy ?? `Apply ${selected} ${selected === 1 ? "match" : "matches"}`}
          </button>
        )}
        {looked && !busy && (
          <span className="text-xs text-secondary">
            {rows.filter((r) => r.preview?.match).length} matched · {rows.filter((r) => r.preview && !r.preview.match).length} not found
          </span>
        )}
      </div>
      {error && <p className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <ul className="divide-y divide-border rounded-card border border-border">
        {rows.map((r) => {
          const m = r.preview?.match ?? null;
          return (
            <li key={r.id} className={`flex gap-3 p-3 ${!looked || r.selected ? "" : "opacity-60"}`}>
              {looked && (
                <input
                  type="checkbox"
                  className="shrink-0 self-center"
                  disabled={!m}
                  checked={r.selected}
                  onChange={(e) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, selected: e.target.checked } : x)))}
                  aria-label={`Apply match for ${r.title}`}
                />
              )}
              <Poster item={{ posterUrl: m?.posterUrl ?? null, type: r.type, title: r.title }} className="w-12 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{r.title}</span>
                  <TypeBadge type={r.type} />
                </div>
                <div className="text-xs text-secondary">{r.creator ?? ""}</div>
                {m && (
                  <div className="mt-1 text-xs text-secondary">
                    Match: {m.title}
                    {m.year ? ` (${m.year})` : ""}
                    {m.creator ? ` · ${m.creator}` : ""}
                  </div>
                )}
                {r.preview?.note && <div className="mt-1 text-xs text-muted">{r.preview.note}</div>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
