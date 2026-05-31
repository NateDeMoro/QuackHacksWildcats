/**
 * Firebase ID-token auth middleware.
 *
 * use when: gating a route on a signed-in user. Verifies the `Authorization: Bearer <idToken>`
 * header via firebase-admin and exposes the verified uid as `c.get('uid')`. The uid comes ONLY
 * from the verified token — never from the request body or query.
 *
 * Offline-dev bypass: with `AUTH_MOCK=1` the token check is skipped and a fake uid
 * (`AUTH_MOCK_UID`, default `dev-user`) is injected, mirroring the STT/Gemini/Firestore mocks.
 */
import type { MiddlewareHandler } from 'hono';
import { getAuthClient } from '../google/clients.js';

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
    return next();
  } catch {
    return c.json({ error: 'invalid token' }, 401);
  }
};
