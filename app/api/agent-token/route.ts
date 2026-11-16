/**
 * GET /api/agent-token — mint a short-lived Firebase custom token for the
 * signed-in user (derived from the session cookie), so the embedded <app-agent>
 * can authenticate as them without a second sign-in.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/firebase/session";
import { adminAuth } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const token = await adminAuth().createCustomToken(user.uid);
    return NextResponse.json({ ok: true, token });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
