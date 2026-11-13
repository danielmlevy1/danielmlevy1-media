import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/firebase/session";
import { getItem } from "@/lib/firestore/data";
import { imdbUrl } from "@/lib/lookup/catalog";
import { STATUS_LABEL } from "@/lib/media/labels";
import { Poster, ProgressText, Stars, TypeBadge } from "@/app/_components/media-bits";
import ItemForm from "./_components/item-form";

export const dynamic = "force-dynamic";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const { id } = await params;
  const item = await getItem(user.uid, id);
  if (!item) notFound();
  const imdb = imdbUrl(item.externalIds);
  const facts = [
    item.creator,
    item.type === "movie" && item.runtimeMinutes ? `${item.runtimeMinutes} min` : null,
    item.type === "show" && item.seasonCount ? `${item.seasonCount} season${item.seasonCount === 1 ? "" : "s"}` : null,
    item.type === "show" && item.runtimeMinutes ? `~${item.runtimeMinutes} min episodes` : null,
    item.type === "book" && item.pageCount ? `${item.pageCount} pages` : null,
  ].filter(Boolean);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <Link href="/list" className="text-sm text-secondary hover:text-primary">← My list</Link>
      {item.archivedAt && (
        <p className="mt-3 rounded-card bg-warn/10 px-3 py-2 text-sm text-secondary">
          This is in the trash. <Link href="/trash" className="text-accent hover:underline">Restore it</Link> to edit.
        </p>
      )}
      <div className="mt-4 flex flex-col gap-6 sm:flex-row">
        <Poster item={item} className="w-40 shrink-0 self-start" />
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="text-2xl font-semibold">
            {item.title} {item.year ? <span className="font-normal text-muted">({item.year})</span> : null}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <TypeBadge type={item.type} />
            <span className="rounded-pill border border-border px-2 py-0.5 text-xs text-secondary">{STATUS_LABEL[item.status]}</span>
            <Stars rating={item.rating} />
            <ProgressText item={item} />
          </div>
          {facts.length > 0 && <p className="text-sm text-secondary">{facts.join(" · ")}</p>}
          {item.genres.length > 0 && <p className="text-xs text-muted">{item.genres.join(", ")}</p>}
          {item.overview && <p className="text-sm leading-relaxed text-secondary">{item.overview}</p>}
          <div className="flex flex-wrap gap-4 pt-1 text-sm">
            {imdb && <a href={imdb} target="_blank" rel="noreferrer" className="text-accent hover:underline">IMDb ↗</a>}
            {item.externalIds.openLibrary && (
              <a href={`https://openlibrary.org/works/${item.externalIds.openLibrary}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">Open Library ↗</a>
            )}
          </div>
        </div>
      </div>
      {!item.archivedAt && <ItemForm item={item} />}
    </main>
  );
}
