/**
 * API tunables: STT lexicon/model and the Gemini report prompt. The single surface for the
 * server-side knobs that were previously scattered across stt/ and the aggregate.
 *
 * use when: tuning filler detection, the STT model, or the report's system instruction.
 */

/** Speech-to-Text recognition model. Supports phrase-set adaptation; NOT chirp/chirp_2. */
export const STT_MODEL = 'latest_long' as const;

/** Default Gemini model for the report; overridden by the `GEMINI_MODEL` env var. */
export const GEMINI_MODEL_DEFAULT = 'gemini-2.5-flash' as const;

/** Default Vertex AI location for Gemini (used when `GEMINI_USE_VERTEX=1`); override via `GOOGLE_CLOUD_LOCATION`. */
export const GEMINI_LOCATION_DEFAULT = 'us-central1' as const;

/**
 * Non-lexical fillers plus the most common verbal crutch. Includes spelling variants because STT
 * picks one spelling and we can't predict which. Conservative overall to avoid over-flagging.
 */
export const FILLER_WORDS = new Set([
  'um', 'umm', 'uh', 'uhh', 'er', 'err', 'erm', 'ah', 'hmm', 'mm', 'mhm', 'like',
]);

/**
 * Speech-adaptation boost: biases STT toward emitting fillers instead of normalizing them away
 * (most ASR models drop unstressed "um"/"uh"). Inline phrase set on the v2 RecognitionConfig.
 * Boost is ~0–20; higher = more likely emitted but more false positives. Tune from real recordings.
 * NOTE: supported by `latest_long`/`latest_short`; NOT by chirp/chirp_2.
 */
export const FILLER_BOOSTS: { value: string; boost: number }[] = [
  { value: 'um', boost: 18 },
  { value: 'umm', boost: 18 },
  { value: 'uh', boost: 18 },
  { value: 'uhh', boost: 18 },
  { value: 'er', boost: 15 },
  { value: 'erm', boost: 15 },
  { value: 'hmm', boost: 12 },
  { value: 'mm', boost: 10 },
];

/**
 * System instruction for the Gemini delivery report. The model receives the session's channel
 * summaries, transcript, planned material, and audience/setting context, and must return JSON
 * matching the Stage-2 subset of AggregateReport (summary, prioritizedAdvice, metrics, coverage).
 */
export const GEMINI_SYSTEM_INSTRUCTION = `You are a speech-delivery coach who calibrates every judgment to the speaker's specific audience and setting. The right pace, volume, formality, and structure depend on who is listening and why.

You receive per-channel delivery summaries (stats, a coarse timeline, and notable events), the full transcript, the planned material, and the audience/setting context.

First infer from the audience/setting what "good" looks like for THIS talk (energy, formality, density, length). Then evaluate against that target, not a generic ideal.

PACE: when an "Authoritative pace reading" (real words/min) is provided, it is the single source of truth for pace — use its average, per-quarter verdicts, and bands for the summary, advice, and the pace metric. Do NOT judge pace from the syllable-rate channel (audio.pace), which is a coarse live proxy that can disagree. Calibrate whether that WPM is actually too fast/slow to the audience, but never contradict its direction (e.g. don't call the talk slow when the reading says fast).

Return ONLY JSON matching the provided schema:
- summary: 2-3 sentences on how well the delivery fits this audience and setting.
- prioritizedAdvice: highest-leverage adjustments for this audience first; each detail explains why it matters for these listeners; evidence[] cites channel ids (e.g. "audio.pace") or short transcript quotes.
- metrics: one readout per signal present; verdict good | watch | flag judged against the audience-appropriate target, not an absolute. Note in value when a reading is fine for this setting even if unusual. Do not invent metrics for absent channels.
- coverage: pointsCovered (planned points actually delivered), pointsMissed (planned points skipped), deviations[] (substantive off-script additions — content the speaker said that was NOT in the planned material; never list filler words, disfluencies, or "um/uh/like/you know" here), and runningLong (true if the talk clearly over/under-ran the material) vs. the planned material and the audience's needs.

If audience/setting is missing, assume a general professional audience and say so in the summary. Never fabricate quotes or numbers.`;

// --- Stage 3 tone call -----------------------------------------------------------
// runAggregate fires two independently-degrading Gemini calls (report + tone). Tone is subjective,
// so the model owns its fields directly (the report keeps the deterministic floor).

/** Tone/sentiment is subjective; kept low so only confident, clear mismatches surface. */
export const GEMINI_TONE_TEMPERATURE = 0.2;
/** Keep only the strongest tone mismatches the model grades — bigger issues, not subtle wobble. */
export const MAX_TONE_FINDINGS = 2;

/**
 * Tone call: detect tone–content mismatches (content sentiment vs delivered prosody). Subjective,
 * so the model owns these fields directly. Receives prosody timelines + material.
 */
export const GEMINI_TONE_INSTRUCTION = `You are a delivery coach detecting tone-content mismatches: places where the emotional content of WHAT was said does not match HOW it was delivered (the prosody).
You receive the transcript, prosody timelines (pitch/volume/pace — stats plus coarse time buckets), and the planned material. Return ONLY JSON matching the schema: a "toneContentMismatch" array.
Set a HIGH bar. Only report a window when the delivered prosody is essentially the OPPOSITE of what the content plainly demands — a stark, sustained contradiction a listener would notice, not a mild or ambiguous wobble. When in doubt, do not report it.
For each mismatch, emit { tStartMs, tEndMs, contentSentiment, deliveredTone, detail, severity }:
- contentSentiment: the sentiment the words imply (e.g. "excited", "urgent", "somber").
- deliveredTone: how the prosody actually came across over that window (e.g. "flat", "rushed", "monotone").
- detail: one concrete sentence naming the gap (e.g. "The strongest result was delivered in a monotone.").
- severity: "strong" only when the contradiction is unmistakable and would clearly undercut the message (e.g. a deliberately wrong tone); otherwise "moderate".
Use the timeline timestamps (ms) to place each window. If delivery broadly matched content, return an empty array. Never fabricate.`;

// --- Gemini verbatim filler recovery (stt/geminiFillers.ts) ---------------------
// STT (`latest_long`) normalizes away disfluencies, so most "um/uh"s are never transcribed (the
// Stage-1 risk; see docs/Problems.md). A parallel Gemini audio pass transcribes verbatim and
// returns ONLY the fillers it dropped; they merge into the transcript as `isDisfluency` words and
// ride the existing `audio.filler` channel. Deterministic (temp 0): this is recovery, not writing.

/** Zero temp — verbatim filler recovery is transcription, not generation. */
export const GEMINI_FILLER_TEMPERATURE = 0;

/**
 * System instruction for the Gemini verbatim filler pass. The model receives one audio clip and
 * returns only the fillers actually spoken, each with clip-relative ms timing. Strictly recovery:
 * no content words, no invention — kept tight to avoid false positives that would inflate the count.
 */
export const GEMINI_FILLER_INSTRUCTION = `You transcribe speech VERBATIM to recover filler words that automatic speech recognition silently drops. You receive one short audio clip.
Return ONLY the fillers actually spoken: non-lexical fillers (um, uh, er, erm, ah, hmm, mm) and the verbal-crutch use of "like" / "you know", plus audible false starts and immediate word repetitions.
Rules:
- Do NOT return ordinary content words. Do NOT invent fillers that were not clearly spoken.
- For each filler give its start and end time in milliseconds from the start of the clip.
- If there are no fillers, return an empty array.
- Output ONLY JSON matching the provided schema.`;

// --- Cost estimation & per-user daily budget (security/cost.ts, security/usageLimit.ts) ---------
// Rates are Google list prices as of 2026-06; tune here if pricing changes. The estimate is meant
// to be a conservative upper bound that keeps real spend near the budget, not exact billing.

/** Hard per-user daily spend cap (USD). Metered routes 429 once a user's UTC-day tally crosses it. */
export const DAILY_BUDGET_USD = 3;

/** Speech-to-Text V2 `latest_long` (standard) list price; billed per 15s chunk, rounded up. */
export const STT_USD_PER_MIN = 0.016;
export const STT_BILL_CHUNK_SEC = 15;

/** Gemini 2.5 Flash list prices (USD per 1M tokens); audio input is billed at ~32 tokens/sec. */
export const GEMINI_USD_PER_1M_TEXT_IN = 0.3;
export const GEMINI_USD_PER_1M_TEXT_OUT = 2.5;
export const GEMINI_USD_PER_1M_AUDIO_IN = 1.0;
export const GEMINI_AUDIO_TOKENS_PER_SEC = 32;

// --- Request size caps (bytes): reject oversized bodies before buffering (memory-DoS guard) ------
/** ~55s of 16kHz mono 16-bit WAV ≈ 1.76 MB; cap with headroom (mirrors the web STT_MAX_SEGMENT_MS). */
export const MAX_TRANSCRIBE_BYTES = 3_000_000;
/** Aggregate JSON ceiling (summaries + transcript + material); ≈ the Firestore 1 MiB doc limit. */
export const MAX_AGGREGATE_BYTES = 1_000_000;

// --- WAV framing: derive audio seconds from a 16kHz mono 16-bit body length ----------------------
export const WAV_HEADER_BYTES = 44;
export const WAV_BYTES_PER_SEC = 32_000; // 16000 Hz * 1 channel * 2 bytes/sample
