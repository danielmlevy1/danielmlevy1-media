/** GET /api/lookup?type=movie|show|book&q=… — title search for the Add screen (session cookie). */
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/firebase/session";
import { LookupError, searchCatalog } from "@/lib/lookup/catalog";
import { getItems } from "@/lib/firestore/data";
import { findDuplicate } from "@/lib/media/item-write";
import { MEDIA_TYPES, type MediaType } from "@/lib/firestore/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const type = request.nextUrl.searchParams.get("type") as MediaType;
  const q = request.nextUrl.searchParams.get("q") ?? "";
  if (!MEDIA_TYPES.includes(type)) return NextResponse.json({ error: "Bad type" }, { status: 400 });
  try {
    const [results, mine] = await Promise.all([searchCatalog(type, q, { limit: 10 }), getItems(user.uid)]);
    return NextResponse.json({
      results: results.map((r) => {
        const dup = findDuplicate(mine, r);
        return { ...r, onList: dup ? { id: dup.id, status: dup.status } : null };
      }),
    });
  } catch (e) {
    const message = e instanceof LookupError ? e.message : "Search failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
