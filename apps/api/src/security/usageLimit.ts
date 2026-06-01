/**
 * Per-user daily cost limit + request-size cap for the metered routes (/transcribe, /aggregate).
 *
 * use when: chaining after requireAuth on a route that bills Google APIs. Each call (1) rejects an
 * oversized body before it is buffered (413 — a memory-DoS guard and the server half of the 10-min
 * cap), then (2) estimates its USD cost, atomically adds it to the caller's UTC-day tally in
 * Firestore (`users/{uid}/usage/{YYYY-MM-DD}.costUsd`), and 429s once the tally crosses
 * DAILY_BUDGET_USD.
 *
 * Posture: skipped in dev when FIRESTORE_MOCK=1; in production a missing/unavailable ledger fails
 * CLOSED (503). Increment-then-read (not a transaction) so the concurrent segment uploads of a
 * chunked talk don't serialize — the worst-case overspend is one in-flight batch of estimates.
 */
import type { MiddlewareHandler } from 'hono';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from '../google/clients.js';
import type { AuthEnv } from '../auth/requireAuth.js';
import { isProd, ledgerBypassed } from './posture.js';
import { aggregateCostUsd, secondsFromWavBytes, transcribeCostUsd } from './cost.js';
import { DAILY_BUDGET_USD, MAX_AGGREGATE_BYTES, MAX_TRANSCRIBE_BYTES } from '../config.js';

type MeteredRoute = 'transcribe' | 'aggregate';

/** UTC date key (YYYY-MM-DD). ISO strings are UTC, so the budget resets at 00:00 UTC. */
function utcDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Build the metered-route guard. `kind` selects the size cap + cost model. */
export function usageLimit(kind: MeteredRoute): MiddlewareHandler<AuthEnv> {
  const maxBytes = kind === 'transcribe' ? MAX_TRANSCRIBE_BYTES : MAX_AGGREGATE_BYTES;
  return async (c, next) => {
    const contentLength = Number(c.req.header('content-length') ?? '0');
    if (contentLength > maxBytes) return c.json({ error: 'payload too large' }, 413);

    if (ledgerBypassed()) return next();
    const db = getFirestore();
    if (!db) {
      if (isProd()) return c.json({ error: 'usage ledger unavailable' }, 503);
      return next(); // dev without Firestore: don't block
    }

    const estimate =
      kind === 'transcribe'
        ? transcribeCostUsd(secondsFromWavBytes(contentLength))
        : aggregateCostUsd(contentLength);

    const ref = db.collection('users').doc(c.get('uid')).collection('usage').doc(utcDateKey());
    try {
      await ref.set(
        { costUsd: FieldValue.increment(estimate), updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      const total = ((await ref.get()).get('costUsd') as number | undefined) ?? estimate;
      if (total > DAILY_BUDGET_USD) {
        return c.json({ error: 'daily usage limit reached', limitUsd: DAILY_BUDGET_USD }, 429);
      }
    } catch (err) {
      console.error('[usage] ledger error:', err);
      if (isProd()) return c.json({ error: 'usage ledger unavailable' }, 503);
    }
    return next();
  };
}
