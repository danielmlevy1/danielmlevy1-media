"use client";

import Link from "next/link";
import { useState } from "react";
import { commitImport, previewImport, type CommitResult, type PreviewRow } from "@/app/import/actions";
import { parseImport } from "@/lib/media/import";
import { STATUS_LABEL } from "@/lib/media/labels";
import { Poster, Stars, TypeBadge } from "@/app/_components/media-bits";

const CHUNK = 12;

type Row = PreviewRow & { selected: boolean; useMatch: boolean };

export default function ImportClient({ moviesSearchable }: { moviesSearchable: boolean }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<CommitResult[] | null>(null);

  async function openFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setText(await f.text());
  }

  async function lookUp() {
    const p = parseImport(text);
    if (!p.ok) return setErrors(p.errors);
    setErrors([]);
    setResults(null);
    const out: Row[] = [];
    for (let i = 0; i < p.rows.length; i += CHUNK) {
      setBusy(`Looking up ${Math.min(i + CHUNK, p.rows.length)} of ${p.rows.length}…`);
      const r = await previewImport(p.rows.slice(i, i + CHUNK));
      if (!r.ok) {
        setErrors([r.error]);
        setBusy(null);
        return;
      }
      out.push(...r.rows.map((x) => ({ ...x, selected: !x.onList, useMatch: !!x.match })));
      setRows([...out]);
    }
    setBusy(null);
  }

  async function importSelected() {
    if (!rows) return;
    const chosen = rows.filter((r) => r.selected);
    const done: CommitResult[] = [];
    for (let i = 0; i < chosen.length; i += CHUNK) {
      setBusy(`Saving ${Math.min(i + CHUNK, chosen.length)} of ${chosen.length}…`);
      const batch = chosen.slice(i, i + CHUNK).map((r) => ({ row: r.row, ref: r.useMatch && r.match ? r.match.ref : null }));
      const res = await commitImport(batch);
      if (!res.ok) {
        setErrors([res.error]);
        break;
      }
      done.push(...res.results);
      setResults([...done]);
    }
    setBusy(null);
    setRows(null);
  }

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const selected = rows?.filter((r) => r.selected).length ?? 0;

  if (results) {
    const ok = results.filter((r) => r.ok).length;
    const failed = results.filter((r): r is Extract<CommitResult, { ok: false }> => !r.ok);
    return (
      <div className="space-y-4">
        <p className="text-sm">
          Added <strong>{ok}</strong> of {results.length}.{busy ? ` ${busy}` : ""}
        </p>
        {failed.length > 0 && (
          <ul className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">
            {failed.map((f, i) => (
              <li key={i}>
                {f.title}: {f.error}
              </li>
            ))}
          </ul>
        )}
        {!busy && (
          <Link href="/list" className="text-sm text-accent hover:underline">
            Go to my list
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {!rows && (
        <div className="space-y-3 rounded-card border border-border p-4">
          {!moviesSearchable && (
            <p className="rounded-card bg-warn/10 px-3 py-2 text-sm text-secondary">
              Movie lookup is off until TMDB_API_KEY is set, so movies would be added without posters or IMDb links.
            </p>
          )}
          <input type="file" accept=".json,application/json" onChange={openFile} className="text-sm" />
          <textarea
            className="input h-48 w-full font-mono text-xs"
            placeholder='{ "items": [ { "type": "movie", "title": "Heat", "year": 1995 } ] }'
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            onClick={lookUp}
            disabled={!text.trim() || !!busy}
            className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy ?? "Look up titles"}
          </button>
        </div>
      )}

      {errors.length > 0 && (
        <ul className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">
          {errors.slice(0, 20).map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {rows && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={importSelected}
              disabled={!!busy || selected === 0}
              className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {busy ?? `Import ${selected} selected`}
            </button>
            <button onClick={() => setRows(null)} disabled={!!busy} className="text-sm text-accent hover:underline">
              Start over
            </button>
            <span className="text-xs text-secondary">
              {rows.filter((r) => r.match).length} matched · {rows.filter((r) => !r.match).length} as typed ·{" "}
              {rows.filter((r) => r.onList).length} already on your list
            </span>
          </div>
          <ul className="divide-y divide-border rounded-card border border-border">
            {rows.map((r, i) => {
              const shown = r.useMatch && r.match ? r.match : null;
              return (
                <li key={i} className={`flex gap-3 p-3 ${r.selected ? "" : "opacity-50"}`}>
                  <input
                    type="checkbox"
                    className="shrink-0 self-center"
                    checked={r.selected}
                    onChange={(e) => set(i, { selected: e.target.checked })}
                    aria-label={`Import ${r.row.title}`}
                  />
                  <Poster item={{ posterUrl: shown?.posterUrl ?? null, type: r.row.type, title: r.row.title }} className="w-12 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{shown?.title ?? r.row.title}</span>
                      <span className="text-xs text-secondary">{shown?.year ?? r.row.year ?? ""}</span>
                      <TypeBadge type={r.row.type} />
                    </div>
                    <div className="text-xs text-secondary">
                      {shown?.creator ?? r.row.creator ?? ""}
                      {shown && shown.title !== r.row.title ? ` · your list says “${r.row.title}”` : ""}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-secondary">
                      <span>{STATUS_LABEL[r.row.status ?? "want"]}</span>
                      <Stars rating={r.row.rating ?? null} />
                      {r.row.finishedAt && <span>finished {r.row.finishedAt}</span>}
                      {(r.row.tags ?? []).map((t) => (
                        <span key={t} className="rounded-pill bg-surface-hover px-2 py-0.5">
                          {t}
                        </span>
                      ))}
                    </div>
                    {r.onList && <div className="mt-1 text-xs text-warn">Already on your list as “{r.onList}”.</div>}
                    {r.note && <div className="mt-1 text-xs text-muted">{r.note}</div>}
                    {r.match && (
                      <button onClick={() => set(i, { useMatch: !r.useMatch })} className="mt-1 text-xs text-accent hover:underline">
                        {r.useMatch ? "Wrong match? Add as typed" : "Use the catalog match"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
