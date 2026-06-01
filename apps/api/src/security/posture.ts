/**
 * Deployment-posture predicates shared by the email allowlist and the usage-limit guard.
 *
 * use when: a server check must fail CLOSED in production but stay out of the way in offline dev.
 * `isProd()` keys off NODE_ENV — the Dockerfile sets it in the runtime stage, so it is true on
 * Cloud Run and unset under local `tsx`. `ledgerBypassed()` mirrors the existing FIRESTORE_MOCK gate
 * so dev with the mock set skips the budget check entirely.
 */

/** True only in the deployed container. Flips the allowlist/ledger checks from "allow" to "deny". */
export const isProd = (): boolean => process.env['NODE_ENV'] === 'production';

/** FIRESTORE_MOCK=1 disables Firestore — the usage ledger can't track, so the budget guard is skipped. */
export const ledgerBypassed = (): boolean => process.env['FIRESTORE_MOCK'] === '1';
