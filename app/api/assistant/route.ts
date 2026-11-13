/**
 * Suite assistant (v2) endpoint: GET → tool manifest, POST → call a tool or
 * execute a confirmed proposal. Contract and confirm tokens come from
 * assistant-kit; the tools are in lib/assistant/tools.ts.
 *
 * Must stay exempt in middleware.ts (it self-auths via the bearer token) and
 * keep CORS `*` (the proxy and launcher call it cross-origin).
 */

import { createAssistantRoutes } from "@daniellevy/assistant-kit";
import { adminAuth } from "@/lib/firebase/admin";
import { burnNonce, sweepExpiredNonces } from "@/lib/agent/nonce-store";
import { MEDIA_TOOLS } from "@/lib/assistant/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const { GET, POST, OPTIONS } = createAssistantRoutes({
  app: "media",
  tools: MEDIA_TOOLS,
  async verifyUser(request) {
    const m = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
    if (!m) return null;
    const decoded = await adminAuth().verifyIdToken(m[1], true);
    return { uid: decoded.uid };
  },
  nonceStore: {
    async burn(uid, nonce, expiresAt) {
      const fresh = await burnNonce(uid, nonce, expiresAt);
      if (fresh) void sweepExpiredNonces(uid);
      return fresh;
    },
  },
});
