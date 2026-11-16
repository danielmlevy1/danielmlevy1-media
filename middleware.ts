import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth middleware — Firebase edition.
 *
 * We only make one lightweight check here (presence of the session cookie),
 * not a full verification. Verification requires firebase-admin which uses
 * Node.js `crypto` primitives that don't work in the Edge runtime. The
 * heavy lifting happens in server components / server actions via
 * lib/firebase/session.getCurrentUser(), which runs on the Node runtime.
 *
 * This middleware exists to short-circuit unauthenticated requests to
 * protected paths (redirect to /sign-in) without invoking any React
 * rendering. Anything that gets past the cookie check still has to prove
 * a valid session downstream — the cookie could be tampered with or
 * expired.
 */

const PUBLIC_PATHS = [
  "/sign-in",
  "/forgot-password",
  "/auth/session", // POST endpoint that mints the session cookie
  "/api/agent-token", // cookie -> custom token for the embedded agent
  "/api/assistant", // suite assistant v2 tools; self-auths via bearer ID token
];

const FIREBASE_SESSION_COOKIE = "__session";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip Next.js internal paths and static assets outright.
  if (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    /\.(?:svg|png|jpg|jpeg|gif|webp)$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Public routes: let them through without touching cookies.
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // Everything else needs a session cookie. If none, bounce to /sign-in.
  const cookie = request.cookies.get(FIREBASE_SESSION_COOKIE)?.value;
  if (!cookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
