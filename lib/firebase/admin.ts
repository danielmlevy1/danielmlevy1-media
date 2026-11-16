/**
 * Firebase Admin SDK — server-side init.
 *
 * Used by:
 *   - Server actions (sign-in cookie minting, password reset orchestration)
 *   - Server components that need privileged Firestore reads/writes
 *
 * Reads the service-account JSON from FIREBASE_SERVICE_ACCOUNT_KEY (set in
 * Vercel env vars + locally in .env.local). The JSON should be the full
 * contents downloaded from Firebase Console → Project settings → Service
 * accounts → Generate new private key.
 *
 * The Admin SDK BYPASSES Firestore Security Rules by design. Anything you
 * do here is unrestricted — be careful.
 */

import {
  getApps,
  initializeApp,
  cert,
  type App,
  type ServiceAccount,
} from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { getStorage as getAdminStorage } from "firebase-admin/storage";

let app: App | null = null;

function ensureApp(): App {
  if (app) return app;

  // Reuse a previously-initialized default app (e.g. in dev hot-reload).
  const existing = getApps()[0];
  if (existing) {
    app = existing;
    return app;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY env var is not set. Download a service " +
        "account key from Firebase Console (Project settings → Service " +
        "accounts) and paste the JSON contents into the env var.",
    );
  }

  // Accept either raw JSON or base64-encoded JSON. Base64 sidesteps dotenv
  // escape-sequence quirks that can silently truncate the value at the first
  // \n inside the private key.
  const trimmed = raw.trim();
  const decoded = trimmed.startsWith("{")
    ? trimmed
    : Buffer.from(trimmed, "base64").toString("utf8");

  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(decoded) as ServiceAccount;
  } catch (err) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON. Did you forget to " +
        "wrap it in quotes / escape newlines? " +
        (err instanceof Error ? err.message : String(err)),
    );
  }

  app = initializeApp({
    credential: cert(parsed),
    storageBucket: "travel-companion-23697.firebasestorage.app",
  });
  return app;
}

export const adminAuth = () => getAdminAuth(ensureApp());
export const adminDb = () => getAdminFirestore(ensureApp());
export const adminStorage = () => getAdminStorage(ensureApp());
