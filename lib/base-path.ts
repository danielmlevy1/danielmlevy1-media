/**
 * The app's basePath (must match next.config.ts `basePath`). Next auto-prefixes
 * <Link>, router, redirect(), and next/image — but NOT fetch(). Use `api()` for
 * every fetch to this app's own routes so it resolves under /media through
 * the launcher's rewrite. Calls to the shared proxy / agent bundle are
 * cross-origin absolute URLs and must NOT use this.
 */
export const BASE_PATH = "/media";

/** Prefix a same-app path with the basePath (e.g. api("/auth/session")). */
export function api(path: string): string {
  return `${BASE_PATH}${path}`;
}
