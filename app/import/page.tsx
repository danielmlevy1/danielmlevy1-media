import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/firebase/session";
import { hasTmdbKey } from "@/lib/lookup/catalog";
import ImportClient from "./_components/import-client";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <h1 className="mb-1 text-2xl font-semibold">Import a list</h1>
      <p className="mb-6 text-sm text-secondary">
        Paste or open a JSON list. Every title is looked up first so you can check the matches; nothing is saved until you press Import.
      </p>
      <ImportClient moviesSearchable={hasTmdbKey()} />
    </main>
  );
}
