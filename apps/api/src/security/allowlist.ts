/**
 * Email allowlist loader.
 *
 * use when: gating API access to a fixed set of emails (see auth/requireAuth.ts). The list is read
 * once from a GITIGNORED JSON file (`{"emails": ["a@x.com", ...]}`) so it can hold real addresses
 * without committing them. Path: `ALLOWLIST_PATH` if set, else `./allowlist.json` resolved against
 * the process cwd.
 *
 * Mirrors the null-on-failure singleton pattern in google/clients.ts: returns null when the file is
 * missing or unparseable. requireAuth turns null into a hard 503 in production (a misconfiguration)
 * and a pass-through in dev; a loaded list that doesn't contain the caller's email is a 403.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let allowlist: Set<string> | null | undefined;

function allowlistPath(): string {
  return process.env['ALLOWLIST_PATH'] ?? resolve(process.cwd(), 'allowlist.json');
}

/** Lazily load + cache the lowercased email set. Null on a missing/invalid file (logged once). */
export function getAllowlist(): Set<string> | null {
  if (allowlist !== undefined) return allowlist;
  try {
    const parsed = JSON.parse(readFileSync(allowlistPath(), 'utf8')) as { emails?: unknown };
    if (!Array.isArray(parsed.emails)) throw new Error('allowlist JSON missing an "emails" array');
    allowlist = new Set(
      parsed.emails
        .filter((e): e is string => typeof e === 'string')
        .map((e) => e.trim().toLowerCase()),
    );
  } catch (err) {
    console.warn('[allowlist] unavailable:', err);
    allowlist = null;
  }
  return allowlist;
}

/** True when `email` is in the loaded allowlist. False when the list is null or the email is absent. */
export function isAllowed(email?: string): boolean {
  const set = getAllowlist();
  if (!set) return false;
  return !!email && set.has(email.toLowerCase());
}
