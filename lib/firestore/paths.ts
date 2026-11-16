/**
 * Firestore collection names for Media. All data is per-user and private:
 * `users/{uid}/md_*`. No top-level md_ collections.
 */

export const USERS = "users";

/** users/{uid}/md_items/{id} — one doc per movie, show or book. Plain docs. */
export const ITEMS = "md_items";

/** users/{uid}/md_agent_nonces/{nonce} — burnt confirm-token nonces (internal). */
export const AGENT_NONCES = "md_agent_nonces";
