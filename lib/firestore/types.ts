/**
 * Media data model. Every record is per-user and private under
 * `users/{uid}/md_*`, stored as a plain doc (no envelope). Field names are a
 * contract with the suite assistant's tools — don't rename them.
 */

export type MediaType = "movie" | "show" | "book";
export const MEDIA_TYPES: readonly MediaType[] = ["movie", "show", "book"];

/** Where an item sits on the list. */
export type MediaStatus = "want" | "in_progress" | "finished" | "dropped";
export const MEDIA_STATUSES: readonly MediaStatus[] = ["want", "in_progress", "finished", "dropped"];

/** Catalog ids, so an item links out (IMDb) and can't be added twice. */
export interface ExternalIds {
  tmdb?: number;
  tvmaze?: number;
  imdb?: string;
  openLibrary?: string;
  isbn?: string;
}

/** Shows track season + episode; books track page or percent; movies none. */
export interface Progress {
  season?: number;
  episode?: number;
  page?: number;
  percent?: number;
}

/** users/{uid}/md_items/{id} */
export interface MediaItem {
  id: string;
  type: MediaType;
  title: string;
  year: number | null;
  /** Director, author, or network. */
  creator: string | null;
  overview: string | null;
  posterUrl: string | null;
  genres: string[];
  /** Movie length, or a typical episode for a show. */
  runtimeMinutes: number | null;
  pageCount: number | null;
  seasonCount: number | null;
  externalIds: ExternalIds;

  status: MediaStatus;
  progress: Progress | null;
  /** 1–5, set when finished (or any time). */
  rating: number | null;
  notes: string | null;
  recommendedBy: string | null;
  /** Free text: "Netflix", "Kindle", "library". */
  whereToWatch: string | null;
  tags: string[];

  /** YYYY-MM-DD, stamped when the status first moves there. */
  startedAt: string | null;
  finishedAt: string | null;

  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}
