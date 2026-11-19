import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/firebase/session";
import { getItems } from "@/lib/firestore/data";
import MatchClient from "./_components/match-client";

export const dynamic = "force-dynamic";

const hasCatalogId = (ids: object) => Object.keys(ids).length > 0;

export default async function MatchPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const items = (await getItems(user.uid))
    .filter((i) => !hasCatalogId(i.externalIds))
    .map((i) => ({ id: i.id, type: i.type, title: i.title, year: i.year, creator: i.creator }));
  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <h1 className="mb-1 text-2xl font-semibold">Find covers</h1>
      <p className="mb-6 text-sm text-secondary">
        These were added without a catalog match, so they have no cover or details. Look them up, check the matches, and apply the ones that are right. Your titles, ratings and dates stay as they are.
      </p>
      <MatchClient items={items} />
    </main>
  );
}
