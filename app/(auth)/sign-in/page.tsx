"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase/client";
import { api } from "@/lib/base-path";

/**
 * Firebase sign-in — two ways in, one pipeline:
 *   1. email/password (signInWithEmailAndPassword) OR Google (signInWithPopup)
 *      → both yield a Firebase ID token
 *   2. POST idToken to /auth/session (route handler mints the session cookie)
 *   3. router.push to /list (or ?next=)
 *
 * The account can carry multiple providers (password + google.com) on the
 * same UID, so either entry point lands on the same data.
 */
export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/list";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** Exchange a Firebase ID token for the session cookie, then navigate. */
  async function establishSession(idToken: string) {
    const res = await fetch(api("/auth/session"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Sign-in failed");
    }
    router.push(next);
    router.refresh();
  }

  function showError(err: unknown) {
    const message = err instanceof Error ? err.message : "Something went wrong";
    const clean = message
      .replace(/^Firebase:\s*Error\s*\(/, "")
      .replace(/\)\.?$/, "");
    setError(
      clean === "auth/invalid-credential" || clean === "auth/wrong-password"
        ? "Wrong email or password."
        : clean === "auth/user-not-found"
          ? "No account for that email."
          : clean === "auth/too-many-requests"
            ? "Too many attempts. Wait a few minutes and try again."
            : clean === "auth/account-exists-with-different-credential"
              ? "That email is already registered with a different sign-in method."
              : clean,
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const credential = await signInWithEmailAndPassword(
        firebaseAuth,
        email.trim(),
        password,
      );
      await establishSession(await credential.user.getIdToken());
    } catch (err) {
      showError(err);
    } finally {
      setPending(false);
    }
  }

  async function onGoogle() {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const credential = await signInWithPopup(
        firebaseAuth,
        new GoogleAuthProvider(),
      );
      await establishSession(await credential.user.getIdToken());
    } catch (err) {
      // User closing the popup isn't an error worth showing.
      const code =
        typeof err === "object" && err !== null && "code" in err
          ? String((err as { code: unknown }).code)
          : "";
      if (
        code === "auth/popup-closed-by-user" ||
        code === "auth/cancelled-popup-request"
      ) {
        // no-op
      } else if (code === "auth/popup-blocked") {
        setError("Your browser blocked the sign-in popup. Allow popups and retry.");
      } else {
        showError(err);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-6 text-2xl font-semibold">Sign in</h1>

      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm text-secondary">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
            className="w-full rounded-card border border-border px-3 py-2 disabled:bg-surface-hover"
          />
        </label>

        <label className="block">
          <span className="mb-1 flex items-baseline justify-between text-sm text-secondary">
            <span>Password</span>
            <Link
              href="/forgot-password"
              className="text-xs text-accent hover:underline"
            >
              Forgot?
            </Link>
          </span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
            className="w-full rounded-card border border-border px-3 py-2 disabled:bg-surface-hover"
          />
        </label>

        {error && (
          <p className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-card bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-surface-hover" />
        <span className="text-xs uppercase tracking-wide text-muted">or</span>
        <span className="h-px flex-1 bg-surface-hover" />
      </div>

      <button
        type="button"
        onClick={onGoogle}
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-card border border-border bg-surface px-3 py-2 text-sm font-medium text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-70"
      >
        <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
          />
          <path
            fill="#34A853"
            d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
          />
          <path
            fill="#FBBC05"
            d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
          />
          <path
            fill="#EA4335"
            d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
          />
        </svg>
        Continue with Google
      </button>

      <p className="mt-6 text-center text-xs text-muted">
        Uses the same account as your other apps.
      </p>
    </main>
  );
}
