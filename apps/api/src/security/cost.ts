/**
 * Per-request cost estimators (USD) for the metered routes.
 *
 * use when: the usage-limit guard needs to charge a request against a user's daily budget. These
 * are conservative list-price estimates from the config.ts rates — STT dominates, Gemini is pennies —
 * not exact billing. All /api/transcribe uploads are 16kHz mono 16-bit WAV, so audio seconds come
 * from the body's byte length.
 */
import {
  STT_USD_PER_MIN,
  STT_BILL_CHUNK_SEC,
  GEMINI_USD_PER_1M_TEXT_IN,
  GEMINI_USD_PER_1M_TEXT_OUT,
  GEMINI_USD_PER_1M_AUDIO_IN,
  GEMINI_AUDIO_TOKENS_PER_SEC,
  WAV_HEADER_BYTES,
  WAV_BYTES_PER_SEC,
} from '../config.js';

/** Audio seconds for a 16kHz mono 16-bit WAV body of `bytes` length (drops the 44-byte header). */
export function secondsFromWavBytes(bytes: number): number {
  return Math.max(0, (bytes - WAV_HEADER_BYTES) / WAV_BYTES_PER_SEC);
}

/** STT cost: bill seconds rounded UP to the next 15s chunk, priced per minute. */
function sttCostUsd(seconds: number): number {
  const billedSec = Math.ceil(seconds / STT_BILL_CHUNK_SEC) * STT_BILL_CHUNK_SEC;
  return (billedSec / 60) * STT_USD_PER_MIN;
}

/** Gemini verbatim filler pass: one audio-input call over the same clip (~32 tokens/sec). */
function geminiAudioCostUsd(seconds: number): number {
  const tokens = seconds * GEMINI_AUDIO_TOKENS_PER_SEC;
  return (tokens / 1_000_000) * GEMINI_USD_PER_1M_AUDIO_IN;
}

/** /transcribe ≈ STT + the concurrent Gemini audio filler pass over the same `seconds` of audio. */
export function transcribeCostUsd(seconds: number): number {
  return sttCostUsd(seconds) + geminiAudioCostUsd(seconds);
}

/**
 * /aggregate ≈ two concurrent Gemini TEXT calls (report + tone). Input tokens are estimated from the
 * JSON payload size (~4 bytes/token); output is bounded by the response schemas.
 */
export function aggregateCostUsd(jsonBytes: number): number {
  const inTokens = jsonBytes / 4;
  const outTokens = 1200; // report/tone JSON ceiling, per call
  const perCall =
    (inTokens / 1_000_000) * GEMINI_USD_PER_1M_TEXT_IN +
    (outTokens / 1_000_000) * GEMINI_USD_PER_1M_TEXT_OUT;
  return perCall * 2;
}
