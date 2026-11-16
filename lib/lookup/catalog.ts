/**
 * Title lookup: type a name, pick a match, and the poster, year, genres,
 * runtime and catalog ids fill themselves in.
 *
 *   - Movies and shows: TMDB (needs TMDB_API_KEY: a v3 key or a v4 read token).
 *   - Shows without a TMDB key: TVmaze (no key).
 *   - Books: Open Library (no key).
 *
 * `searchCatalog` returns light candidates; `fetchDetails` fills one in fully
 * (IMDb id, runtime, seasons, where it streams) when it's actually added.
 * Parsers are exported and tested against recorded responses; `fetchImpl` is
 * injectable so nothing in the tests touches the network.
 */

import type { ExternalIds, MediaType } from "@/lib/firestore/types";

export type CatalogSource = "tmdb" | "tvmaze" | "openlibrary";

export interface CatalogRef {
  source: CatalogSource;
  /** TMDB / TVmaze numeric id as a string, or an Open Library work id ("OL45883W"). */
  id: string;
  type: MediaType;
}

/** Catalog facts about a title (no list state). */
export interface CatalogEntry {
  ref: CatalogRef;
  type: MediaType;
  title: string;
  year: number | null;
  creator: string | null;
  overview: string | null;
  posterUrl: string | null;
  genres: string[];
  runtimeMinutes: number | null;
  pageCount: number | null;
  seasonCount: number | null;
  externalIds: ExternalIds;
  /** Streaming services in the US, from TMDB (JustWatch data). */
  streaming: string[];
}

type Fetch = typeof fetch;
type Json = Record<string, unknown>;

const TMDB = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w342";
const TIMEOUT_MS = 8000;

export class LookupError extends Error {}

export function hasTmdbKey(): boolean {
  return !!process.env.TMDB_API_KEY?.trim();
}

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Json[]) : []);
const yearOf = (d: unknown): number | null => {
  const m = /^(\d{4})/.exec(String(d ?? ""));
  return m ? Number(m[1]) : null;
};
const names = (v: unknown): string[] => arr(v).map((x) => s(x.name)).filter((x): x is string => !!x);
/** TVmaze summaries are HTML. */
export const stripHtml = (h: unknown): string | null =>
  s(String(h ?? "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " "));

async function getJson(url: string, fetchImpl: Fetch, headers: Record<string, string> = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new LookupError("The title search didn't answer. Try again in a moment.");
  }
  if (res.status === 401) throw new LookupError("The movie database key isn't valid. Check TMDB_API_KEY on Vercel.");
  if (!res.ok) throw new LookupError(`The title search failed (HTTP ${res.status}).`);
  return res.json();
}

function tmdbUrl(path: string, params: Record<string, string> = {}): { url: string; headers: Record<string, string> } {
  const key = process.env.TMDB_API_KEY?.trim() ?? "";
  const q = new URLSearchParams({ language: "en-US", ...params });
  // A v4 read-access token is a JWT; a v3 key is 32 hex characters.
  const headers: Record<string, string> = {};
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  else q.set("api_key", key);
  return { url: `${TMDB}${path}?${q}`, headers };
}

// -----------------------------------------------------------------------------
// Parsers (pure)
// -----------------------------------------------------------------------------

function blank(ref: CatalogRef, title: string): CatalogEntry {
  return {
    ref,
    type: ref.type,
    title,
    year: null,
    creator: null,
    overview: null,
    posterUrl: null,
    genres: [],
    runtimeMinutes: null,
    pageCount: null,
    seasonCount: null,
    externalIds: {},
    streaming: [],
  };
}

/** One row of TMDB /search/movie or /search/tv. */
export function parseTmdbSearchRow(row: Json, type: "movie" | "show"): CatalogEntry | null {
  const id = n(row.id);
  const title = s(type === "movie" ? row.title : row.name);
  if (!id || !title) return null;
  const e = blank({ source: "tmdb", id: String(id), type }, title);
  e.year = yearOf(type === "movie" ? row.release_date : row.first_air_date);
  e.overview = s(row.overview);
  e.posterUrl = s(row.poster_path) ? `${TMDB_IMG}${row.poster_path}` : null;
  e.externalIds = { tmdb: id };
  return e;
}

function usStreaming(details: Json): string[] {
  const us = ((details["watch/providers"] as Json | undefined)?.results as Json | undefined)?.US as Json | undefined;
  return [...new Set(names(arr(us?.flatrate).map((p) => ({ name: p.provider_name }))))];
}

/** TMDB /movie/{id} or /tv/{id} with external_ids, credits and watch/providers appended. */
export function parseTmdbDetails(d: Json, type: "movie" | "show"): CatalogEntry | null {
  const e = parseTmdbSearchRow(d, type);
  if (!e) return null;
  e.genres = names(d.genres);
  const imdb = s(d.imdb_id) ?? s((d.external_ids as Json | undefined)?.imdb_id);
  if (imdb) e.externalIds.imdb = imdb;
  e.streaming = usStreaming(d);
  if (type === "movie") {
    e.runtimeMinutes = n(d.runtime);
    const crew = arr((d.credits as Json | undefined)?.crew);
    e.creator = names(crew.filter((c) => c.job === "Director")).join(", ") || null;
  } else {
    const runtimes = Array.isArray(d.episode_run_time) ? (d.episode_run_time as unknown[]).map(n).filter((x): x is number => !!x) : [];
    e.runtimeMinutes = runtimes[0] ?? n((d.last_episode_to_air as Json | undefined)?.runtime);
    e.seasonCount = n(d.number_of_seasons);
    e.creator = names(d.networks)[0] ?? (names(d.created_by).join(", ") || null);
  }
  return e;
}

/** One TVmaze show object (from /search/shows rows' `.show`, or /shows/{id}). */
export function parseTvmazeShow(show: Json): CatalogEntry | null {
  const id = n(show.id);
  const title = s(show.name);
  if (!id || !title) return null;
  const e = blank({ source: "tvmaze", id: String(id), type: "show" }, title);
  e.year = yearOf(show.premiered);
  e.overview = stripHtml(show.summary);
  const img = show.image as Json | undefined;
  e.posterUrl = s(img?.medium) ?? s(img?.original);
  e.genres = Array.isArray(show.genres) ? (show.genres as unknown[]).map(s).filter((x): x is string => !!x) : [];
  e.runtimeMinutes = n(show.averageRuntime) ?? n(show.runtime);
  e.creator = s((show.network as Json | undefined)?.name) ?? s((show.webChannel as Json | undefined)?.name);
  e.externalIds = { tvmaze: id };
  const imdb = s((show.externals as Json | undefined)?.imdb);
  if (imdb) e.externalIds.imdb = imdb;
  const seasons = arr((show._embedded as Json | undefined)?.seasons);
  if (seasons.length) e.seasonCount = seasons.length;
  // A streaming-only show's web channel is where it's watched.
  const web = s((show.webChannel as Json | undefined)?.name);
  if (web) e.streaming = [web];
  return e;
}

/** One doc of Open Library /search.json. */
export function parseOpenLibraryDoc(doc: Json): CatalogEntry | null {
  const work = s(doc.key)?.replace(/^\/works\//, "");
  const title = s(doc.title);
  if (!work || !title) return null;
  const e = blank({ source: "openlibrary", id: work, type: "book" }, title);
  e.year = n(doc.first_publish_year);
  const authors = Array.isArray(doc.author_name) ? (doc.author_name as unknown[]).map(s).filter(Boolean) : [];
  e.creator = authors.slice(0, 2).join(", ") || null;
  e.posterUrl = n(doc.cover_i) ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null;
  e.pageCount = n(doc.number_of_pages_median);
  const subjects = Array.isArray(doc.subject) ? (doc.subject as unknown[]).map(s).filter((x): x is string => !!x) : [];
  e.genres = subjects.filter((x) => x.length < 30 && !/^(fiction|accessible book|protected daisy|in library)/i.test(x)).slice(0, 4);
  e.externalIds = { openLibrary: work };
  const isbn = Array.isArray(doc.isbn) ? s((doc.isbn as unknown[])[0]) : null;
  if (isbn) e.externalIds.isbn = isbn;
  return e;
}

/** Open Library /works/{id}.json description: a string or { value }. */
export function parseOpenLibraryDescription(work: Json): string | null {
  const d = work.description;
  return s(typeof d === "string" ? d : (d as Json | undefined)?.value);
}

// -----------------------------------------------------------------------------
// Network calls
// -----------------------------------------------------------------------------

/** Search the right catalog for a type. Throws LookupError with a readable message. */
export async function searchCatalog(type: MediaType, query: string, opts: { limit?: number; fetchImpl?: Fetch } = {}): Promise<CatalogEntry[]> {
  const q = query.trim();
  if (!q) return [];
  const limit = opts.limit ?? 8;
  const f = opts.fetchImpl ?? fetch;

  if (type === "book") {
    const params = new URLSearchParams({ q, limit: String(limit), fields: "key,title,author_name,first_publish_year,cover_i,number_of_pages_median,isbn,subject" });
    const data = (await getJson(`https://openlibrary.org/search.json?${params}`, f)) as Json;
    return arr(data.docs).map(parseOpenLibraryDoc).filter((x): x is CatalogEntry => !!x).slice(0, limit);
  }

  if (hasTmdbKey()) {
    const { url, headers } = tmdbUrl(type === "movie" ? "/search/movie" : "/search/tv", { query: q, include_adult: "false" });
    const data = (await getJson(url, f, headers)) as Json;
    return arr(data.results).map((r) => parseTmdbSearchRow(r, type)).filter((x): x is CatalogEntry => !!x).slice(0, limit);
  }

  if (type === "show") {
    const data = (await getJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`, f)) as unknown[];
    return arr(data).map((r) => parseTvmazeShow((r.show ?? {}) as Json)).filter((x): x is CatalogEntry => !!x).slice(0, limit);
  }

  throw new LookupError("Movie search needs the TMDB key (TMDB_API_KEY on Vercel). You can still add a movie by typing its title.");
}

/** Full details for one catalog entry, for when it's added to the list. */
export async function fetchDetails(ref: CatalogRef, opts: { fetchImpl?: Fetch } = {}): Promise<CatalogEntry> {
  const f = opts.fetchImpl ?? fetch;
  if (ref.source === "tmdb") {
    if (ref.type === "book") throw new LookupError("TMDB has no books.");
    const path = ref.type === "movie" ? `/movie/${encodeURIComponent(ref.id)}` : `/tv/${encodeURIComponent(ref.id)}`;
    const { url, headers } = tmdbUrl(path, { append_to_response: "external_ids,credits,watch/providers" });
    const e = parseTmdbDetails((await getJson(url, f, headers)) as Json, ref.type);
    if (!e) throw new LookupError("That title wasn't found.");
    return e;
  }
  if (ref.source === "tvmaze") {
    const e = parseTvmazeShow((await getJson(`https://api.tvmaze.com/shows/${encodeURIComponent(ref.id)}?embed=seasons`, f)) as Json);
    if (!e) throw new LookupError("That show wasn't found.");
    return e;
  }
  // Open Library: the work has the description; search has the rest, so look it up by work id.
  const params = new URLSearchParams({ q: `key:/works/${ref.id}`, limit: "1", fields: "key,title,author_name,first_publish_year,cover_i,number_of_pages_median,isbn,subject" });
  const [found, work] = await Promise.all([
    getJson(`https://openlibrary.org/search.json?${params}`, f) as Promise<Json>,
    (getJson(`https://openlibrary.org/works/${encodeURIComponent(ref.id)}.json`, f) as Promise<Json>).catch(() => ({}) as Json),
  ]);
  const e = parseOpenLibraryDoc(arr(found.docs)[0] ?? { key: `/works/${ref.id}`, title: s(work.title) });
  if (!e) throw new LookupError("That book wasn't found.");
  e.overview = parseOpenLibraryDescription(work);
  return e;
}

/** IMDb page for an item, when its id is known. */
export function imdbUrl(ids: ExternalIds): string | null {
  return ids.imdb && /^tt\d+$/.test(ids.imdb) ? `https://www.imdb.com/title/${ids.imdb}/` : null;
}

/** The catalog fields of an entry, ready for createItemRecord. */
export function entryToInput(e: CatalogEntry) {
  return {
    type: e.type,
    title: e.title,
    year: e.year,
    creator: e.creator,
    overview: e.overview,
    posterUrl: e.posterUrl,
    genres: e.genres,
    runtimeMinutes: e.runtimeMinutes,
    pageCount: e.pageCount,
    seasonCount: e.seasonCount,
    externalIds: e.externalIds,
    whereToWatch: e.streaming.length ? e.streaming.slice(0, 3).join(", ") : null,
  };
}
