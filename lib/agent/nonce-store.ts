/**
 * Single-use enforcement for confirm tokens.
 *
 * A valid signature alone would let the same confirmed action be replayed —
 * tapping confirm once could add the same title five times. Burning the nonce
 * makes each proposal executable exactly once.
 *
 * The burn is a Firestore `create()`, which fails if the doc already exists.
 * That's what makes it atomic: two concurrent replays race, and exactly one
 * wins. Checking-then-writing would let both through.
 */

import { adminDb } from "@/lib/firebase/admin";
import { AGENT_NONCES } from "@/lib/firestore/paths";

function nonceCol(uid: string) {
  return adminDb().collection("users").doc(uid).collection(AGENT_NONCES);
}

/**
 * Claim a nonce. Returns false if it was already used.
 * Docs are tiny and short-lived; `sweepExpiredNonces` clears them out.
 */
export async function burnNonce(uid: string, nonce: string, expiresAt: number): Promise<boolean> {
  try {
    await nonceCol(uid)
      .doc(nonce)
      .create({ nonce, usedAt: new Date().toISOString(), expiresAt });
    return true;
  } catch {
    // ALREADY_EXISTS — a replay. Any other failure is also treated as "don't
    // run it": refusing a legitimate action is far cheaper than double-writing.
    return false;
  }
}

/**
 * Opportunistic cleanup. Called after a successful burn so the collection
 * doesn't grow forever; bounded so it can never dominate a request.
 */
export async function sweepExpiredNonces(uid: string, now = Date.now()): Promise<void> {
  try {
    const stale = await nonceCol(uid).where("expiresAt", "<", now).limit(25).get();
    if (stale.empty) return;
    const batch = adminDb().batch();
    stale.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } catch {
    /* housekeeping only — never fail a write because cleanup didn't run */
  }
}
