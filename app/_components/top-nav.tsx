import Link from "next/link";
import { getCurrentUser } from "@/lib/firebase/session";
import { signOut } from "@/app/(auth)/actions";

/** Slim app-wide header; user chrome only with an active session. */
export default async function TopNav() {
  const user = await getCurrentUser();
  const link = "text-secondary hover:text-primary hover:underline";
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href={user ? "/list" : "/sign-in"} className="text-sm font-semibold tracking-tight text-primary">
          🎬 Media
        </Link>
        {user && (
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/list" className={link}>My list</Link>
            <Link href="/add" className={link}>Add</Link>
            <Link href="/trash" className={link}>Trash</Link>
            <span className="hidden text-muted md:inline">{user.email}</span>
            <form action={signOut}>
              <button type="submit" className={link}>Sign out</button>
            </form>
          </nav>
        )}
      </div>
    </header>
  );
}
