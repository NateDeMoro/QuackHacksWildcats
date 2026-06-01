/**
 * Firebase ID-token auth middleware.
 *
 * use when: gating a route on a signed-in user. Verifies the `Authorization: Bearer <idToken>`
 * header via firebase-admin and exposes the verified uid as `c.get('uid')`. The uid comes ONLY
 * from the verified token — never from the request body or query.
 *
 * After verification the token's email is checked against the security/allowlist.ts set: an email
 * not on the list is 403; a missing list is 503 in production (misconfiguration) and allowed in dev.
 *
 * Offline-dev bypass: with `AUTH_MOCK=1` the token check is skipped and a fake uid
 * (`AUTH_MOCK_UID`, default `dev-user`) is injected, mirroring the STT/Gemini/Firestore mocks.
 */
import type { MiddlewareHandler } from 'hono';
import { getAuthClient } from '../google/clients.js';
import { getAllowlist, isAllowed } from '../security/allowlist.js';
import { isProd } from '../security/posture.js';

/** Hono env: routes behind `requireAuth` can read `c.get('uid')`. */
export type AuthEnv = { Variables: { uid: string } };

export const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  if (process.env['AUTH_MOCK'] === '1') {
    c.set('uid', process.env['AUTH_MOCK_UID'] ?? 'dev-user');
    return next();
  }

  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return c.json({ error: 'unauthenticated' }, 401);

  const auth = getAuthClient();
  if (!auth) return c.json({ error: 'auth unavailable' }, 500);

  try {
    const decoded = await auth.verifyIdToken(token);
    c.set('uid', decoded.uid);

    // Email allowlist (fail-closed in prod; dev skips via the AUTH_MOCK early-return above).
    const set = getAllowlist();
    if (set === null) {
      if (isProd()) return c.json({ error: 'allowlist unavailable' }, 503);
    } else if (!decoded.email_verified || !isAllowed(decoded.email)) {
      return c.json({ error: 'account not authorized' }, 403);
    }
    return next();
  } catch {
    return c.json({ error: 'invalid token' }, 401);
  }
};
