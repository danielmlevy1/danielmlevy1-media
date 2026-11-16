/** Display labels. Pure, so client components can import them. */
import type { MediaItem, MediaStatus, MediaType } from "@/lib/firestore/types";

export const STATUS_LABEL: Record<MediaStatus, string> = {
  want: "Want to",
  in_progress: "In progress",
  finished: "Finished",
  dropped: "Dropped",
};

export const TYPE_LABEL: Record<MediaType, string> = { movie: "Movie", show: "Show", book: "Book" };

/** "S2 E4", "page 120", "45%", or null. */
export function progressLabel(type: MediaItem["type"], p: MediaItem["progress"]): string | null {
  if (!p) return null;
  if (type === "show" && (p.season !== undefined || p.episode !== undefined)) return `S${p.season ?? 1} E${p.episode ?? 0}`;
  if (type === "book" && p.page !== undefined) return `page ${p.page}`;
  if (type === "book" && p.percent !== undefined) return `${p.percent}%`;
  return null;
}
