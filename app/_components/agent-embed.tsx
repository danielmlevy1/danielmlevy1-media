"use client";

import { useEffect } from "react";
import { api } from "@/lib/base-path";

/**
 * Embeds the shared launcher agent (<app-agent>) scoped to this app. It loads
 * the hosted bundle once and mounts the element imperatively (so we don't need
 * a JSX declaration for the custom element). The agent authenticates from this
 * app's session cookie via /api/agent-token — no second sign-in.
 */
export default function AgentEmbed({ scope }: { scope: string }) {
  useEffect(() => {
    if (!document.querySelector("script[data-app-agent]")) {
      const s = document.createElement("script");
      s.type = "module";
      s.src = "https://launcher-site-nu.vercel.app/app-agent.js";
      s.setAttribute("data-app-agent", "");
      document.head.appendChild(s);
    }
    if (!document.querySelector("app-agent")) {
      const el = document.createElement("app-agent");
      el.setAttribute("scope", scope);
      el.setAttribute("token-endpoint", api("/api/agent-token"));
      document.body.appendChild(el);
    }
  }, [scope]);
  return null;
}
