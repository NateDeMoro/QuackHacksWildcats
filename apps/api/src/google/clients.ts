/**
 * Google client stubs (Stage 2+).
 *
 * use when: wiring Gemini, Speech-to-Text, and Firestore. Keep ALL Google credentials here —
 * never expose keys to the web client. On Cloud Run, prefer Application Default Credentials /
 * the runtime service account over inline API keys.
 *
 * Placeholders only for now so the server compiles without the SDKs installed.
 */

import { v2 } from '@google-cloud/speech';
import { GoogleGenAI } from '@google/genai';
import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';
import { getFirestore as adminGetFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth as adminGetAuth, type Auth } from 'firebase-admin/auth';
import { GEMINI_MODEL_DEFAULT, GEMINI_LOCATION_DEFAULT } from '../config.js';

export interface GoogleConfig {
  /** GCP project id (from env on Cloud Run). */
  projectId?: string;
  /** Gemini model id, e.g. 'gemini-2.0-flash'. */
  geminiModel?: string;
  /**
   * Gemini Developer API (AI Studio) key — used on the default path (`useVertex` false). STT,
   * Firestore, and Auth always use ADC; this key is the one exception. Never commit it.
   */
  geminiApiKey?: string;
  /** When true (`GEMINI_USE_VERTEX=1`), Gemini runs on Vertex AI via ADC instead of the AI Studio key. */
  useVertex?: boolean;
  /** Vertex AI location for Gemini (when `useVertex`); defaults to `GEMINI_LOCATION_DEFAULT`. */
  geminiLocation?: string;
}

export function loadGoogleConfig(): GoogleConfig {
  return {
    projectId: process.env['GOOGLE_CLOUD_PROJECT'],
    geminiModel: process.env['GEMINI_MODEL'] ?? GEMINI_MODEL_DEFAULT,
    geminiApiKey: process.env['GEMINI_API_KEY'],
    useVertex: process.env['GEMINI_USE_VERTEX'] === '1',
    geminiLocation: process.env['GOOGLE_CLOUD_LOCATION'] ?? GEMINI_LOCATION_DEFAULT,
  };
}

let speechClient: v2.SpeechClient | null | undefined;

/**
 * Lazily build the Speech-to-Text v2 client via Application Default Credentials (no inline key —
 * the Cloud Run runtime service account locally `gcloud auth application-default login`).
 *
 * use when: transcribing audio. Returns null when STT is explicitly disabled (`STT_MOCK=1`) or the
 * client can't be constructed (SDK/creds absent), so callers degrade to a mock transcript.
 */
export function getSpeechClient(): v2.SpeechClient | null {
  if (speechClient !== undefined) return speechClient;
  if (process.env['STT_MOCK'] === '1') {
    speechClient = null;
    return null;
  }
  try {
    speechClient = new v2.SpeechClient();
  } catch (err) {
    console.warn('[stt] SpeechClient unavailable, falling back to mock:', err);
    speechClient = null;
  }
  return speechClient;
}

let geminiClient: GoogleGenAI | null | undefined;

/**
 * Lazily build the Gemini client. Two paths, selected by `GEMINI_USE_VERTEX`:
 *  - default (unset/0): AI Studio (Gemini Developer API) free-tier key from `GEMINI_API_KEY`.
 *  - `GEMINI_USE_VERTEX=1`: Vertex AI over ADC (the same creds STT/Firestore/Auth use), no key —
 *    needs `GOOGLE_CLOUD_PROJECT`, a location (`GOOGLE_CLOUD_LOCATION`/`GEMINI_LOCATION_DEFAULT`),
 *    the Vertex AI API enabled, and `roles/aiplatform.user`.
 *
 * use when: generating the delivery report or the filler pass. Returns null when Gemini is disabled
 * (`GEMINI_MOCK=1`), the selected path's credentials are missing, or the client can't be built — so
 * the aggregate degrades to a deterministic stub report.
 */
export function getGeminiClient(): GoogleGenAI | null {
  if (geminiClient !== undefined) return geminiClient;
  if (process.env['GEMINI_MOCK'] === '1') {
    geminiClient = null;
    return null;
  }
  try {
    const { geminiApiKey, useVertex, projectId, geminiLocation } = loadGoogleConfig();
    if (useVertex) {
      if (!projectId) {
        console.warn('[gemini] GEMINI_USE_VERTEX=1 but GOOGLE_CLOUD_PROJECT not set, falling back to stub report');
        geminiClient = null;
        return null;
      }
      // Vertex AI over ADC (the same credentials STT/Firestore/Auth use) — no API key.
      geminiClient = new GoogleGenAI({ vertexai: true, project: projectId, location: geminiLocation });
    } else {
      if (!geminiApiKey) {
        console.warn('[gemini] GEMINI_API_KEY not set, falling back to stub report');
        geminiClient = null;
        return null;
      }
      geminiClient = new GoogleGenAI({ apiKey: geminiApiKey });
    }
  } catch (err) {
    console.warn('[gemini] client unavailable, falling back to stub report:', err);
    geminiClient = null;
  }
  return geminiClient;
}

let firestore: Firestore | null | undefined;

/**
 * Lazily build the Firestore client via firebase-admin over Application Default Credentials.
 * `ignoreUndefinedProperties` is set so optional report fields (e.g. an absent `coverage`) don't
 * throw on write.
 *
 * use when: persisting or reading rehearsal sessions. Returns null when disabled
 * (`FIRESTORE_MOCK=1`) or unavailable, so persistence is best-effort and never blocks the report.
 */
export function getFirestore(): Firestore | null {
  if (firestore !== undefined) return firestore;
  if (process.env['FIRESTORE_MOCK'] === '1') {
    firestore = null;
    return null;
  }
  try {
    const { projectId } = loadGoogleConfig();
    if (getApps().length === 0) {
      initializeApp({ projectId, credential: applicationDefault() });
    }
    firestore = adminGetFirestore();
    firestore.settings({ ignoreUndefinedProperties: true });
  } catch (err) {
    console.warn('[firestore] unavailable, persistence disabled:', err);
    firestore = null;
  }
  return firestore;
}

let auth: Auth | null | undefined;

/**
 * Lazily build the firebase-admin Auth client over Application Default Credentials. Shares the
 * single admin app with `getFirestore()` (the `getApps().length === 0` guard prevents a double
 * `initializeApp`, whichever runs first).
 *
 * use when: verifying a client's Firebase ID token in the auth middleware. Returns null when
 * disabled (`AUTH_MOCK=1`) or unavailable — callers treat null as a server misconfiguration.
 */
export function getAuthClient(): Auth | null {
  if (auth !== undefined) return auth;
  if (process.env['AUTH_MOCK'] === '1') {
    auth = null;
    return null;
  }
  try {
    const { projectId } = loadGoogleConfig();
    if (getApps().length === 0) {
      initializeApp({ projectId, credential: applicationDefault() });
    }
    auth = adminGetAuth();
  } catch (err) {
    console.warn('[auth] firebase-admin Auth unavailable:', err);
    auth = null;
  }
  return auth;
}
