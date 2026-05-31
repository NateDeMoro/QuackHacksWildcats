/**
 * `fetch` wrapper that attaches the signed-in user's Firebase ID token.
 *
 * use when: calling any `/api/...` route (all of them require auth). Reads the current user and
 * mints a fresh ID token per request (`getIdToken()` auto-refreshes near expiry), then sets the
 * `Authorization: Bearer` header without clobbering caller headers (e.g. `content-type`). If no
 * user is signed in, the request goes out without the header — but the app's login gate means
 * that should not happen in practice.
 */
import { auth } from '../firebase.js';

export async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const user = auth.currentUser;
  if (user) {
    headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
  }
  return fetch(input, { ...init, headers });
}
