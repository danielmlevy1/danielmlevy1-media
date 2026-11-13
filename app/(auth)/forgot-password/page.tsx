"use client";

import Link from "next/link";
import { useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase/client";

/**
 * Password reset — CLIENT-side on purpose.
 *
 * This must use the Web SDK's sendPasswordResetEmail(), which actually
 * delivers mail using Firebase Auth's built-in template. The Admin SDK's
 * generatePasswordResetLink() only *builds* a link — it sends nothing, and
 * relying on it silently no-ops (user sees "check your inbox", no email
 * ever arrives). Same reason sign-in is client-side.
 *
 * Error handling is deliberately narrow: ONLY auth/user-not-found is
 * swallowed into the generic confirmation, so we don't leak which emails
 * have accounts. Every other failure (invalid email, network, quota,
 * misconfig) is surfaced — swallowing them all makes a broken send look
 * identical to a successful one, and the user waits forever for an email
 * that was never requested.
 */
const SILENT_CODES = new Set(["auth/user-not-found"]);

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      await sendPasswordResetEmail(firebaseAuth, email.trim());
      setSent(true);
    } catch (err) {
      const code =
        typeof err === "object" && err !== null && "code" in err
          ? String((err as { code: unknown }).code)
          : "";
      if (SILENT_CODES.has(code)) {
        // Account doesn't exist — show the same message as success.
        setSent(true);
      } else {
        setError(
          code === "auth/invalid-email"
            ? "That doesn't look like a valid email address."
            : code === "auth/too-many-requests"
              ? "Too many attempts. Wait a few minutes and try again."
              : `Couldn't send the reset email${code ? ` (${code})` : ""}. Try again.`,
        );
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-6 text-2xl font-semibold">Reset password</h1>

      {sent ? (
        <p className="rounded-card bg-success/10 px-3 py-2 text-sm text-success">
          If that email is on file, a reset link is on its way. Check your inbox.
        </p>
      ) : (
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
            {pending ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm">
        <Link href="/sign-in" className="text-secondary hover:underline">
          ← Back to sign in
        </Link>
      </p>
    </main>
  );
}
