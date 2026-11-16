"use client";

import { useEffect } from "react";
import { api, BASE_PATH } from "@/lib/base-path";

/**
 * SSO handoff receiver. When the portal opens this app with a fresh Firebase
 * ID token in the URL fragment (#__aht=...), exchange it for this app's session
 * cookie so the user is signed in without a second login. The fragment is never
 * sent to a server and is stripped immediately.
 */
export default function AuthHandoff() {
  useEffect(() => {
    const m = window.location.hash.match(/(?:^|[#&])__aht=([^&]+)/);
    if (!m) return;
    const idToken = decodeURIComponent(m[1]);
    // Strip the token from the URL right away (before any await).
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    (async () => {
      try {
        const res = await fetch(api("/auth/session"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        });
        if (res.ok) {
          const next = new URLSearchParams(window.location.search).get("next") || "/";
          // `next` is basePath-less. Re-prepend basePath so we land INSIDE this
          // app — special-casing root, because api("/") = "/media/" (trailing
          // slash) 404s under the launcher rewrite; send root to BASE_PATH.
          const dest =
            next === "/"
              ? BASE_PATH
              : next.startsWith(BASE_PATH)
                ? next
                : api(next);
          window.location.replace(dest);
        }
      } catch {
        /* fall through — the user can still sign in normally */
      }
    })();
  }, []);
  return null;
}
