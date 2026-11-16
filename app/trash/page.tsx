import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/firebase/session";
import { getArchivedItems } from "@/lib/firestore/data";
import { TYPE_LABEL } from "@/lib/media/labels";
import { restoreItem } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function TrashPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const items = await getArchivedItems(user.uid);
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="mb-5 text-2xl font-semibold">Trash</h1>
      {items.length === 0 ? (
        <p className="text-sm text-secondary">Nothing in the trash.</p>
      ) : (
        <ul className="divide-y divide-border rounded-card border border-border bg-surface">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <Link href={`/item/${i.id}`} className="min-w-0 truncate text-sm hover:underline">
                {i.title} <span className="text-muted">· {TYPE_LABEL[i.type]}</span>
              </Link>
              <form action={restoreItem}>
                <input type="hidden" name="id" value={i.id} />
                <button type="submit" className="text-sm text-accent hover:underline">Restore</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
