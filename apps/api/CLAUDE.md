# @quack/api

Cloud Run service. Proxies Gemini + Speech-to-Text and persists sessions to Firestore.
Stage 2: `/api/aggregate` returns a context-aware Gemini report (Vertex AI, JSON mode) and
best-effort persists the session; `/api/sessions` lists/retrieves prior rehearsals.

## Edit rules
- ALL Google credentials/keys live here, never in the web app. Prefer Cloud Run's runtime
  service account (Application Default Credentials) over inline API keys.
- Routes are mounted under **`/api`** (Hono `basePath('/api')`) — Firebase Hosting rewrites
  `/api/**` here unstripped, and the web Vite proxy mirrors it. Keep new routes under `/api`.
- Implement the report against the `AggregateFn` contract in `@quack/shared` — don't redefine it.
- `@quack/shared` is bundled into `dist` by tsup (it is TS source, not a published package).

## Files
| Path | Description | Open when... |
|------|-------------|--------------|
| src/server.ts | Hono server (/api basePath): /health (public), /aggregate (+persist), /sessions, /sessions/:id, /transcribe (all `requireAuth`); CORS allowlist | adding routes |
| src/auth/requireAuth.ts | Hono middleware: verify `Authorization: Bearer <idToken>` → `c.get('uid')`; `AUTH_MOCK` bypass | gating a route on a user |
| src/config.ts | STT lexicon/boosts/`STT_MODEL` + `GEMINI_SYSTEM_INSTRUCTION` (report prompt) | tuning STT or the report prompt |
| src/stt/transcribe.ts | batch STT v2: audio → Transcript, filler-lexicon disfluency tags | tuning transcription |
| src/aggregate/runAggregate.ts | AggregateFn impl: Gemini JSON-mode report + deterministic floors + stub fallback | building the report |
| src/google/clients.ts | Speech + Gemini (Vertex) + Firestore clients (ADC, env-gated mocks) | wiring Google SDKs |
| Dockerfile | Cloud Run container (build from repo root) | deploying |

## Clients & mocks (`google/clients.ts`)
- All four follow the same lazy-singleton + null-on-failure pattern; each has a mock gate:
  `STT_MOCK=1` (mock transcript), `GEMINI_MOCK=1` (deterministic stub report), `FIRESTORE_MOCK=1`
  (persistence disabled), `AUTH_MOCK=1` (skip ID-token verify; middleware injects `AUTH_MOCK_UID`,
  default `dev-user`). Run all four set to skip every Google call for offline dev.
- ADC only (no keys). Gemini uses Vertex AI (`{ vertexai: true, location: 'us-central1' }`);
  Firestore + Auth share one firebase-admin app (`getApps().length===0` guard); Firestore sets
  `ignoreUndefinedProperties`. `getAuthClient()` is consumed only by `requireAuth`.
- Deps: `@google/genai`, `firebase-admin` (added Stage 2), `@google-cloud/speech`.

## Auth & per-user data
- Routes require a verified Firebase ID token (`requireAuth`); the uid comes ONLY from the token,
  never the body/query. `/health` stays public.
- Sessions are stored per user at `users/{uid}/sessions/{sessionId}` (ownership is path-based, so a
  foreign id read just 404s — no composite index, no manual `where(uid)` filter to forget).
- CORS is an allowlist (hosting origins + `localhost:5173`) with `Authorization` allowed; Cloud Run
  itself stays `--allow-unauthenticated` (auth is enforced in-app, not at the platform edge).

## STT notes
- Sync `recognize` caps inline audio at ~60s — fine for short clips; full-length needs streaming.

## Report & persistence notes
- `runAggregate` degrades like STT: no Gemini client → `stubReport`; malformed JSON → caught →
  `stubReport`. `floorMetrics` (volume/pause from `findSummary`) keeps the report non-empty.
- `responseSchema` covers the Stage-2 subset only (summary/prioritizedAdvice/metrics/coverage);
  `schemaVersion` is attached server-side, never by the model.
- `/aggregate` persists `sessions/{id}` best-effort: summaries + transcript + report + context,
  **not** raw `series` (1 MiB doc limit). Failure logs but still returns the report.

## Run
- Dev: `pnpm --filter @quack/api dev` (tsx, port 8080).
- Build: `pnpm --filter @quack/api build` → self-contained `dist/server.js`.
