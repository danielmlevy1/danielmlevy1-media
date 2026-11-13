import type { MediaItem, MediaType } from "@/lib/firestore/types";
import { progressLabel } from "@/lib/media/labels";

const TYPE_ICON: Record<MediaType, string> = { movie: "🎬", show: "📺", book: "📚" };

/** Poster or cover art, with a type icon when there's none. Catalog CDNs allow hotlinking. */
export function Poster({ item, className = "" }: { item: Pick<MediaItem, "posterUrl" | "type" | "title">; className?: string }) {
  return (
    <div className={`relative aspect-[2/3] overflow-hidden rounded-card bg-surface-hover ${className}`}>
      {item.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-3xl">{TYPE_ICON[item.type]}</div>
      )}
    </div>
  );
}

export function TypeBadge({ type }: { type: MediaType }) {
  const label = { movie: "Movie", show: "Show", book: "Book" }[type];
  return (
    <span className="rounded-pill bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
      {TYPE_ICON[type]} {label}
    </span>
  );
}

export function Stars({ rating }: { rating: number | null }) {
  if (!rating) return null;
  return (
    <span className="text-xs text-warn" aria-label={`${rating} out of 5`}>
      {"★".repeat(rating)}
      <span className="text-muted">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

export function ProgressText({ item }: { item: MediaItem }) {
  const p = progressLabel(item.type, item.progress);
  if (!p) return null;
  const of =
    item.type === "show" && item.seasonCount ? ` of ${item.seasonCount} seasons` : item.type === "book" && item.pageCount && item.progress?.page !== undefined ? ` of ${item.pageCount}` : "";
  return <span className="text-xs text-secondary">{p}{of}</span>;
}
