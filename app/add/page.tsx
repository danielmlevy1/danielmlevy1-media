import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/firebase/session";
import { hasTmdbKey } from "@/lib/lookup/catalog";
import AddClient from "./_components/add-client";

export const dynamic = "force-dynamic";

export default async function AddPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="mb-1 text-2xl font-semibold">Add a title</h1>
      <p className="mb-6 text-sm text-secondary">Search, pick the right one, and the poster, year and details fill in.</p>
      <AddClient moviesSearchable={hasTmdbKey()} />
    </main>
  );
}
