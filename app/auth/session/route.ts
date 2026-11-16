/**
 * POST /auth/session — exchange a Firebase ID token (from the client SDK
 * after signInWithEmailAndPassword) for an HTTP-only session cookie.
 *
 * The sign-in client component flow:
 *   1. Call signInWithEmailAndPassword(email, password) on firebase/auth
 *   2. Get the resulting user's idToken via user.getIdToken()
 *   3. POST { idToken } to this route
 *   4. Browser stores the resulting __session cookie
 *   5. Subsequent navigations / server actions see the cookie via
 *      lib/firebase/session.ts getCurrentUser()
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSessionFromIdToken } from "@/lib/firebase/session";

export async function POST(request: NextRequest) {
  let body: { idToken?: string };
  try {
    body = (await request.json()) as { idToken?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const idToken = body.idToken?.trim();
  if (!idToken) {
    return NextResponse.json({ error: "Missing idToken" }, { status: 400 });
  }

  try {
    await createSessionFromIdToken(idToken);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign-in failed";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
