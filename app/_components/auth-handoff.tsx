"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase/client";
import { api } from "@/lib/base-path";

/**
 * One sign-in for the whole suite (same file in every cookie app; keep them
 * in sync — see LAUNCHER-INTEGRATION.md §3c).
 *
 * Every app is served from the same origin (www.daniellevy.app/<app>) and uses
 * the same Firebase project, so the launcher's Firebase sign-in is already
 * stored in this browser. This component turns it into this app's
 * `__session` cookie so you never see a second sign-in screen:
 *
 * 1. Handoff: a launcher tile opens the app with #__aht=<ID token>. Strip it
 *    (before any await) and exchange it for the session cookie.
 * 2. Silent sign-in: on the sign-in page (bookmark, direct link, expired
 *    cookie, switching apps from the side bar), if this browser is already
 *    signed in to the suite, use that sign-in instead of showing the form.
 *    The server still verifies the token exactly
 *    as for a typed sign-in; this only skips the form.
 * 3. Sign-out: the app's sign-out lands on /sign-in?signedout=1, which also
 *    signs this browser out of the suite, so step 2 can't sign you straight
 *    back in.
 *
 * A failed attempt falls back to the normal form, and a 30-second guard stops
 * a retry loop if the server keeps refusing the session.
 */

const BASE = api("/").replace(/\/$/, "");
const GUARD_KEY = "suite-sso-attempt";
const GUARD_MS = 30_000;

/** Where to go after sign-in: the ?next= path, kept inside this app. */
function destination(): string {
  const next = new URLSearchParams(window.location.search).get("next") || "/";
  // Only same-app paths ("/x"), never "//host" or a full URL.
  if (!next.startsWith("/") || next.startsWith("//")) return BASE;
  if (next === "/") return BASE;
  // `next` is basePath-less; api("/") = "/<app>/" (trailing slash) 404s under
  // the launcher rewrite, so root goes to BASE.
  return next === BASE || next.startsWith(BASE + "/") ? next : BASE + next;
}

async function startSession(idToken: string): Promise<boolean> {
  const res = await fetch(api("/auth/session"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  return res.ok;
}

function recentlyTried(): boolean {
  try {
    const at = Number(sessionStorage.getItem(GUARD_KEY) || 0);
    return Date.now() - at < GUARD_MS;
  } catch {
    return false;
  }
}

function markTried(): void {
  try {
    sessionStorage.setItem(GUARD_KEY, String(Date.now()));
  } catch {
    /* storage blocked: the guard is best-effort */
  }
}

export default function AuthHandoff() {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const done = () => !cancelled && setBusy(false);

    // 1. Handoff from a launcher tile.
    const m = window.location.hash.match(/(?:^|[#&])__aht=([^&]+)/);
    if (m) {
      const idToken = decodeURIComponent(m[1]);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setBusy(true);
      startSession(idToken)
        .then((ok) => (ok ? window.location.replace(destination()) : done()))
        .catch(done);
      return () => {
        cancelled = true;
      };
    }

    const onSignInPage = window.location.pathname === BASE + "/sign-in";
    if (!onSignInPage) {
      return;
    }

    // 3. Signed out on purpose: sign the whole browser out of the suite.
    if (new URLSearchParams(window.location.search).has("signedout")) {
      signOut(firebaseAuth).catch(() => {});
      return;
    }

    // 2. Silent sign-in from the suite's existing sign-in.
    if (recentlyTried()) return;
    setBusy(true);
    const unsub = onAuthStateChanged(firebaseAuth, async (user) => {
      unsub();
      if (!user) return done();
      markTried();
      try {
        if (await startSession(await user.getIdToken())) {
          window.location.replace(destination());
          return;
        }
      } catch {
        /* fall back to the form */
      }
      done();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  if (!busy) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "Canvas",
        color: "CanvasText",
        font: "500 15px/1.4 system-ui, sans-serif",
      }}
    >
      Signing you in…
    </div>
  );
}
