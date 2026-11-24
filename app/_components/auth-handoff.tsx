"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase/client";
import { api } from "@/lib/base-path";

/**
 * One sign-in for the whole suite (same file in every cookie app; keep them
 * in sync — see LAUNCHER-INTEGRATION.md §3c).
 *
 * Normally you never get here: the launcher keeps a site-wide `__suite`
 * cookie that this app accepts (lib/firebase/session.ts, middleware.ts), so
 * pages open signed in. This component only covers the edges:
 *
 * - On any normal page: a leftover launcher #__aht= token is stripped from
 *   the URL and ignored (the page loaded, so you're already signed in).
 * - On /sign-in (no valid cookie): use the launcher's hand-off token or this
 *   browser's suite sign-in to start a session and continue, showing only
 *   "Signing you in…". If this browser isn't signed in at all, go to the
 *   launcher to sign in (?next= brings you back). The app's own form shows
 *   only if that fails twice within 30 seconds.
 * - /sign-in?signedout=1 (the app's sign-out): sign the browser out of the
 *   suite and return to the launcher.
 *
 * The server still verifies every token exactly as for a typed sign-in.
 */

const BASE = api("/").replace(/\/$/, "");
const GUARD_KEY = "suite-sso-attempt";
const GUARD_MS = 30_000;

/** Where to go after sign-in: the ?next= path, kept inside this app. */
function destination(): string {
  const next = new URLSearchParams(window.location.search).get("next") || "/";
  // Only same-app paths ("/x"), never "//host", "/\host" or a full URL.
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return BASE;
  if (next === "/") return BASE;
  // `next` is basePath-less; api("/") = "/<app>/" (trailing slash) 404s under
  // the launcher rewrite, so root goes to BASE.
  return next === BASE || next.startsWith(BASE + "/") ? next : BASE + next;
}

async function startSession(idToken: string): Promise<boolean> {
  // Refresh the launcher's suite-wide cookie too, so the next app opens
  // straight in. Best-effort: this app's own cookie is what we wait for.
  fetch("/auth/suite", { method: "POST", headers: { Authorization: "Bearer " + idToken } })
    .then((r) => r.ok && localStorage.setItem("suite-session-at", String(Date.now())))
    .catch(() => {});
  const res = await fetch(api("/auth/session"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  return res.ok;
}

/** True if we already tried within 30s (stops a loop if something keeps refusing). */
function triedRecently(): boolean {
  try {
    const at = Number(sessionStorage.getItem(GUARD_KEY) || 0);
    if (Date.now() - at < GUARD_MS) return true;
    sessionStorage.setItem(GUARD_KEY, String(Date.now()));
  } catch {
    /* storage blocked: the guard is best-effort */
  }
  return false;
}

function currentUser(): Promise<User | null> {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(firebaseAuth, (u) => {
      unsub();
      resolve(u);
    });
  });
}

export default function AuthHandoff() {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const m = window.location.hash.match(/(?:^|[#&])__aht=([^&]+)/);
    if (m) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const handoff = m ? decodeURIComponent(m[1]) : null;

    if (window.location.pathname !== BASE + "/sign-in") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    setBusy(true);
    (async () => {
      // Signed out on purpose: sign the whole browser out, back to the launcher.
      if (params.has("signedout")) {
        try {
          localStorage.removeItem("suite-session-at");
          await signOut(firebaseAuth);
        } catch {
          /* still leave */
        }
        window.location.replace("/");
        return;
      }
      if (triedRecently()) return !cancelled && setBusy(false);
      try {
        const user = handoff ? null : await currentUser();
        const token = handoff ?? (user ? await user.getIdToken() : null);
        if (!token) {
          // Not signed in anywhere: sign in once on the launcher, then come back.
          window.location.replace("/?next=" + encodeURIComponent(destination()));
          return;
        }
        if (await startSession(token)) {
          window.location.replace(destination());
          return;
        }
      } catch {
        /* fall back to the form */
      }
      if (!cancelled) setBusy(false);
    })();
    return () => {
      cancelled = true;
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
