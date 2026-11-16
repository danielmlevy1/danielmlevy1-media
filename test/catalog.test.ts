import { afterEach, describe, expect, it, vi } from "vitest";
import {
  entryToInput,
  fetchDetails,
  imdbUrl,
  parseOpenLibraryDescription,
  parseOpenLibraryDoc,
  parseTmdbDetails,
  parseTvmazeShow,
  searchCatalog,
} from "@/lib/lookup/catalog";

/** Trimmed real responses. */
const TMDB_TV = {
  id: 95396,
  name: "Severance",
  first_air_date: "2022-02-17",
  overview: "Mark leads a team of office workers…",
  poster_path: "/abc.jpg",
  genres: [{ id: 18, name: "Drama" }, { id: 9648, name: "Mystery" }],
  number_of_seasons: 2,
  episode_run_time: [],
  last_episode_to_air: { runtime: 56 },
  networks: [{ name: "Apple TV+" }],
  external_ids: { imdb_id: "tt11280740" },
  "watch/providers": { results: { US: { flatrate: [{ provider_name: "Apple TV+" }, { provider_name: "Apple TV+" }] } } },
};
const TMDB_MOVIE = {
  id: 438631,
  title: "Dune",
  release_date: "2021-09-15",
  overview: "Paul Atreides…",
  poster_path: "/d.jpg",
  runtime: 155,
  imdb_id: "tt1160419",
  genres: [{ name: "Science Fiction" }],
  credits: { crew: [{ job: "Producer", name: "X" }, { job: "Director", name: "Denis Villeneuve" }] },
  "watch/providers": { results: { US: { flatrate: [{ provider_name: "Max" }] } } },
};
const TVMAZE = {
  id: 44933,
  name: "Severance",
  premiered: "2022-02-18",
  summary: "<p><b>Severance</b> follows Mark &amp; his team.</p>",
  image: { medium: "https://static.tvmaze.com/m.jpg" },
  genres: ["Drama", "Thriller"],
  averageRuntime: 54,
  network: null,
  webChannel: { name: "Apple TV+" },
  externals: { imdb: "tt11280740" },
  _embedded: { seasons: [{}, {}] },
};
const OL_DOC = {
  key: "/works/OL893415W",
  title: "Dune",
  author_name: ["Frank Herbert"],
  first_publish_year: 1965,
  cover_i: 11481354,
  number_of_pages_median: 604,
  isbn: ["9780441013593"],
  subject: ["Fiction", "Science fiction", "Arrakis (Imaginary place)"],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  delete process.env.TMDB_API_KEY;
});

describe("parsers", () => {
  it("reads a TMDB show with network, seasons, IMDb id and de-duplicated streaming", () => {
    const e = parseTmdbDetails(TMDB_TV, "show")!;
    expect(e).toMatchObject({
      title: "Severance",
      year: 2022,
      creator: "Apple TV+",
      seasonCount: 2,
      runtimeMinutes: 56,
      genres: ["Drama", "Mystery"],
      posterUrl: "https://image.tmdb.org/t/p/w342/abc.jpg",
      externalIds: { tmdb: 95396, imdb: "tt11280740" },
      streaming: ["Apple TV+"],
    });
  });

  it("reads a TMDB movie's director and runtime", () => {
    const e = parseTmdbDetails(TMDB_MOVIE, "movie")!;
    expect(e).toMatchObject({ creator: "Denis Villeneuve", runtimeMinutes: 155, externalIds: { imdb: "tt1160419" } });
    expect(entryToInput(e).whereToWatch).toBe("Max");
  });

  it("reads a TVmaze show and strips its HTML summary", () => {
    const e = parseTvmazeShow(TVMAZE)!;
    expect(e).toMatchObject({ overview: "Severance follows Mark & his team.", creator: "Apple TV+", seasonCount: 2, runtimeMinutes: 54, externalIds: { tvmaze: 44933, imdb: "tt11280740" } });
  });

  it("reads an Open Library doc, dropping junk subjects", () => {
    const e = parseOpenLibraryDoc(OL_DOC)!;
    expect(e).toMatchObject({
      ref: { source: "openlibrary", id: "OL893415W", type: "book" },
      creator: "Frank Herbert",
      year: 1965,
      pageCount: 604,
      posterUrl: "https://covers.openlibrary.org/b/id/11481354-M.jpg",
      genres: ["Science fiction", "Arrakis (Imaginary place)"],
      externalIds: { openLibrary: "OL893415W", isbn: "9780441013593" },
    });
    expect(parseOpenLibraryDescription({ description: { value: "Desert planet." } })).toBe("Desert planet.");
    expect(parseOpenLibraryDescription({ description: "Plain." })).toBe("Plain.");
  });

  it("skips rows with no id or title", () => {
    expect(parseTvmazeShow({ name: "x" })).toBeNull();
    expect(parseOpenLibraryDoc({ title: "x" })).toBeNull();
  });

  it("only links a real IMDb id", () => {
    expect(imdbUrl({ imdb: "tt1160419" })).toBe("https://www.imdb.com/title/tt1160419/");
    expect(imdbUrl({ imdb: "javascript:x" })).toBeNull();
  });
});

describe("searchCatalog", () => {
  it("uses TVmaze for shows when there's no TMDB key", async () => {
    const f = vi.fn(async (_url: string) => json([{ show: TVMAZE }]));
    const r = await searchCatalog("show", "severance", { fetchImpl: f as unknown as typeof fetch });
    expect(f.mock.calls[0][0]).toBe("https://api.tvmaze.com/search/shows?q=severance");
    expect(r[0].ref).toEqual({ source: "tvmaze", id: "44933", type: "show" });
  });

  it("uses TMDB with a v4 token as a bearer header, and a v3 key as a param", async () => {
    process.env.TMDB_API_KEY = "eyJtoken";
    const f = vi.fn(async (_url: string, _init?: RequestInit) => json({ results: [{ id: 1, title: "Dune", release_date: "2021-01-01" }] }));
    await searchCatalog("movie", "dune", { fetchImpl: f as unknown as typeof fetch });
    expect((f.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe("Bearer eyJtoken");
    expect(f.mock.calls[0][0]).not.toContain("api_key");
    process.env.TMDB_API_KEY = "abc123";
    await searchCatalog("movie", "dune", { fetchImpl: f as unknown as typeof fetch });
    expect(f.mock.calls[1][0]).toContain("api_key=abc123");
  });

  it("explains that movie search needs the key", async () => {
    await expect(searchCatalog("movie", "dune", { fetchImpl: vi.fn() as unknown as typeof fetch })).rejects.toThrow(/TMDB_API_KEY/);
  });

  it("turns a bad key into a readable error", async () => {
    process.env.TMDB_API_KEY = "bad";
    const f = vi.fn(async () => json({}, 401));
    await expect(searchCatalog("show", "x", { fetchImpl: f as unknown as typeof fetch })).rejects.toThrow(/isn't valid/);
  });

  it("fetches an Open Library book's description with its details", async () => {
    const f = vi.fn(async (url: string) => (url.includes("/works/") ? json({ description: "Desert planet." }) : json({ docs: [OL_DOC] })));
    const e = await fetchDetails({ source: "openlibrary", id: "OL893415W", type: "book" }, { fetchImpl: f as unknown as typeof fetch });
    expect(e).toMatchObject({ title: "Dune", overview: "Desert planet." });
  });
});
