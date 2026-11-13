"use client";

/**
 * Firebase Web SDK — browser-side init.
 *
 * Used by client components that need:
 *   - Auth state (signInWithEmailAndPassword, signOut, onAuthStateChanged)
 *   - Reset-password and update-password flows that use Firebase's hosted
 *     action handler
 *
 * Reads NEXT_PUBLIC_FIREBASE_CONFIG (JSON string of the web app config from
 * Firebase Console → Project settings → General → Your apps).
 *
 * NB: server-side code MUST NOT import from this module. Use lib/firebase/
 * admin.ts on the server instead.
 */

import { initializeApp, getApps, type FirebaseOptions } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const raw = process.env.NEXT_PUBLIC_FIREBASE_CONFIG;
if (!raw) {
  // Throwing on import would break SSR — we want this to be lazy. Log so
  // the missing env var is visible during development.
  if (typeof window !== "undefined") {
    console.error(
      "NEXT_PUBLIC_FIREBASE_CONFIG is missing. Sign-in will not work.",
    );
  }
}

const config: FirebaseOptions = raw ? JSON.parse(raw) : ({} as FirebaseOptions);

const app = getApps().length === 0 ? initializeApp(config) : getApps()[0]!;

export const firebaseAuth: Auth = getAuth(app);
