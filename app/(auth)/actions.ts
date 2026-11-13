"use server";

/**
 * Auth server actions — Firebase edition.
 *
 * Both sign-in and password-reset are CLIENT-side: the Web SDK is the only
 * way to get an ID token, and it's the only one that actually *sends* the
 * reset email (the Admin SDK's generatePasswordResetLink only builds a link
 * and delivers nothing). See app/(auth)/sign-in/page.tsx and
 * app/(auth)/forgot-password/page.tsx.
 *
 * That leaves just the cookie operation here.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearSession } from "@/lib/firebase/session";

export async function signOut() {
  await clearSession();
  revalidatePath("/", "layout");
  redirect("/sign-in");
}
