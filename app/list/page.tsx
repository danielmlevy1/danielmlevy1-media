import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/firebase/session";
import { getItems } from "@/lib/firestore/data";
import { MEDIA_STATUSES, type MediaItem, type MediaStatus, type MediaType } from "@/lib/firestore/types";
import { STATUS_LABEL } from "@/lib/media/labels";
import { quickAction } from "@/app/actions";
import { Poster, ProgressText, Stars, TypeBadge } from "@/app/_components/media-bits";

export const dynamic = "force-dynamic";

const TYPES: { id: MediaType | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "show", label: "Shows" },
  { id: "movie", label: "Movies" },
  { id: "book", label: "Books" },
];

/** Tabs in the order you use them: what you're on, then what's next. */
const TAB_ORDER: MediaStatus[] = ["in_progress", "want", "finished", "dropped"];

type Search = { status?: string; type?: string; q?: string };

function href(cur: Search, next: Partial<Search>) {
  const p = new URLSearchParams();
  const merged = { ...cur, ...next };
  for (const [k, v] of Object.entries(merged)) if (v && v !== "all") p.set(k, v);
  const s = p.toString();
  return s ? `/list?${s}` : "/list";
}

function sortFor(status: MediaStatus) {
  if (status === "finished") return (a: MediaItem, b: MediaItem) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? "") || b.updatedAt.localeCompare(a.updatedAt);
  if (status === "in_progress") return (a: MediaItem, b: MediaItem) => b.updatedAt.localeCompare(a.updatedAt);
  return (a: MediaItem, b: MediaItem) => b.createdAt.localeCompare(a.createdAt);
}

export default async function ListPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const sp = await searchParams;
  const all = await getItems(user.uid);

  const type = (TYPES.some((t) => t.id === sp.type) ? sp.type : "all") as MediaType | "all";
  const ofType = all.filter((i) => type === "all" || i.type === type);
  const counts = Object.fromEntries(MEDIA_STATUSES.map((s) => [s, ofType.filter((i) => i.status === s).length])) as Record<MediaStatus, number>;
  const status: MediaStatus = MEDIA_STATUSES.includes(sp.status as MediaStatus)
    ? (sp.status as MediaStatus)
    : counts.in_progress
      ? "in_progress"
      : "want";
  const words = (sp.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const shown = ofType
    .filter((i) => i.status === status)
    .filter((i) => {
      if (!words.length) return true;
      const hay = [i.title, i.creator, i.recommendedBy, i.whereToWatch, ...i.genres, ...i.tags].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort(sortFor(status));
  const cur: Search = { status, type, q: sp.q };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">My list</h1>
        <Link href="/add" className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
          + Add a title
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {TAB_ORDER.map((s) => (
          <Link
            key={s}
            href={href(cur, { status: s })}
            className={`rounded-pill border px-3 py-1.5 text-sm ${s === status ? "border-accent bg-accent-soft text-primary" : "border-border text-secondary hover:bg-surface-hover"}`}
          >
            {STATUS_LABEL[s]} <span className="text-muted">{counts[s]}</span>
          </Link>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-card border border-border p-1">
          {TYPES.map((t) => (
            <Link
              key={t.id}
              href={href(cur, { type: t.id })}
              className={`rounded-card px-3 py-1 text-sm ${t.id === type ? "bg-surface-hover text-primary" : "text-secondary hover:text-primary"}`}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <form action="/media/list" className="min-w-48 flex-1">
          <input type="hidden" name="status" value={status} />
          {type !== "all" && <input type="hidden" name="type" value={type} />}
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Filter by title, genre, who recommended it…" className="input" />
        </form>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-card border border-dashed border-border px-6 py-12 text-center text-secondary">
          {all.length === 0 ? (
            <>
              Nothing here yet. <Link href="/add" className="text-accent hover:underline">Add your first show, movie or book</Link>, or ask the assistant: “add Severance to my list”.
            </>
          ) : (
            <>Nothing {STATUS_LABEL[status].toLowerCase()} here{words.length ? " that matches" : ""}.</>
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {shown.map((i) => (
            <li key={i.id} className="flex flex-col overflow-hidden rounded-card border border-border bg-surface">
              <Link href={`/item/${i.id}`} className="block">
                <Poster item={i} className="rounded-none" />
              </Link>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <Link href={`/item/${i.id}`} className="line-clamp-2 text-sm font-medium leading-snug hover:underline">
                  {i.title}
                  {i.year ? <span className="font-normal text-muted"> ({i.year})</span> : null}
                </Link>
                <div className="flex flex-wrap items-center gap-2">
                  <TypeBadge type={i.type} />
                  <Stars rating={i.rating} />
                </div>
                <ProgressText item={i} />
                {i.recommendedBy && <span className="text-xs text-muted">From {i.recommendedBy}</span>}
                {i.whereToWatch && <span className="truncate text-xs text-muted">{i.whereToWatch}</span>}
                <QuickButtons item={i} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function QuickButtons({ item }: { item: MediaItem }) {
  const buttons: { action: string; label: string }[] = [];
  if (item.status === "want") buttons.push({ action: "start", label: item.type === "book" ? "Start reading" : "Start" });
  if (item.status === "in_progress" && item.type === "show") buttons.push({ action: "next_episode", label: "+1 episode" });
  if (item.status === "want" || item.status === "in_progress") buttons.push({ action: "finish", label: "Finished" });
  if (!buttons.length) return null;
  return (
    <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
      {buttons.map((b) => (
        <form key={b.action} action={quickAction}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="action" value={b.action} />
          <button type="submit" className="rounded-pill border border-border px-2.5 py-1 text-xs text-secondary hover:border-accent hover:text-primary">
            {b.label}
          </button>
        </form>
      ))}
    </div>
  );
}
