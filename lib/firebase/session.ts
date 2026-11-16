/**
 * Firebase Auth session-cookie helpers (server-side).
 *
 * Firebase Web SDK signs the user in client-side, returning an ID token.
 * That token is short-lived (~1 hour). To survive page navigations and
 * server components, we mint a long-lived session cookie via the Admin
 * SDK and store it as an HTTP-only cookie. Each server request then
 * verifies the cookie + revocation status.
 *
 * Cookie name: __session (Firebase Hosting convention; also fine here).
 * Max age: 5 days (Firebase Admin SDK upper bound is 14 days).
 *
 * Used by:
 *   - app/auth/session/route.ts — exchange ID token → session cookie on sign-in
 *   - middleware.ts — verify the cookie + refresh if needed
 *   - server actions that need the current user
 */

import { cookies } from "next/headers";
import { adminAuth } from "@/lib/firebase/admin";

export const FIREBASE_SESSION_COOKIE = "__session";
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * Trade a Firebase ID token (from client SDK sign-in) for a server-side
 * session cookie. Sets the cookie on the response.
 *
 * `checkRevoked: true` on the ID-token verify ensures we don't mint a
 * cookie from a token that's been revoked since sign-in.
 */
export async function createSessionFromIdToken(idToken: string): Promise<void> {
  const auth = adminAuth();
  // Validate the ID token first — catches replays, expired tokens, etc.
  await auth.verifyIdToken(idToken, true);

  const sessionCookie = await auth.createSessionCookie(idToken, {
    expiresIn: FIVE_DAYS_MS,
  });

  const store = await cookies();
  store.set(FIREBASE_SESSION_COOKIE, sessionCookie, {
    maxAge: FIVE_DAYS_MS / 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    // Scope to the basePath so peer apps on the shared launcher origin
    // (launcher-site-nu.vercel.app/{holdings,tax,travel,insurance}) don't collide
    // on the __session cookie.
    path: "/media",
  });
}

/**
 * Read + verify the session cookie. Returns the decoded claims (which
 * include `uid` and `email`), or null if no cookie / verification fails.
 *
 * Pass `checkRevoked: true` to also catch sign-outs from other devices,
 * at the cost of an extra round-trip to Firebase Auth on every request.
 */
export async function getCurrentUser(checkRevoked = false): Promise<{
  uid: string;
  email: string | null;
} | null> {
  const store = await cookies();
  const cookieValue = store.get(FIREBASE_SESSION_COOKIE)?.value;
  if (!cookieValue) return null;

  try {
    const decoded = await adminAuth().verifySessionCookie(
      cookieValue,
      checkRevoked,
    );
    return { uid: decoded.uid, email: decoded.email ?? null };
  } catch {
    // Expired / invalid / revoked — caller should treat as signed out.
    return null;
  }
}

/** Clear the session cookie (sign-out). */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  // Must match the path the cookie was set with (/media) or the delete
  // silently no-ops and sign-out doesn't clear the session.
  store.delete({ name: FIREBASE_SESSION_COOKIE, path: "/media" });
}
