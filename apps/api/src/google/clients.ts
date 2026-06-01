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
import { GEMINI_MODEL_DEFAULT } from '../config.js';

export interface GoogleConfig {
  /** GCP project id (from env on Cloud Run). */
  projectId?: string;
  /** Gemini model id, e.g. 'gemini-2.0-flash'. */
  geminiModel?: string;
  /**
   * Gemini Developer API (AI Studio) key. When set, Gemini runs on the AI Studio free-tier key
   * path instead of Vertex AI/ADC. STT, Firestore, and Auth still use ADC. Never commit this key.
   */
  geminiApiKey?: string;
}

export function loadGoogleConfig(): GoogleConfig {
  return {
    projectId: process.env['GOOGLE_CLOUD_PROJECT'],
    geminiModel: process.env['GEMINI_MODEL'] ?? GEMINI_MODEL_DEFAULT,
    geminiApiKey: process.env['GEMINI_API_KEY'],
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
 * Lazily build the Gemini client on the AI Studio (Gemini Developer API) free-tier key from
 * `GEMINI_API_KEY` — chosen over Vertex/ADC so report/tone/filler calls bill against the free tier.
 *
 * use when: generating the delivery report. Returns null when Gemini is explicitly disabled
 * (`GEMINI_MOCK=1`), the key is unset, or the client can't be constructed, so the aggregate
 * degrades to a deterministic stub report.
 */
export function getGeminiClient(): GoogleGenAI | null {
  if (geminiClient !== undefined) return geminiClient;
  if (process.env['GEMINI_MOCK'] === '1') {
    geminiClient = null;
    return null;
  }
  try {
    const { geminiApiKey } = loadGoogleConfig();
    if (!geminiApiKey) {
      console.warn('[gemini] GEMINI_API_KEY not set, falling back to stub report');
      geminiClient = null;
      return null;
    }
    geminiClient = new GoogleGenAI({ apiKey: geminiApiKey });
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
