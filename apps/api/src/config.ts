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
export const GEMINI_SYSTEM_INSTRUCTION = `You are an expert speech-delivery coach reviewing a rehearsal.
You receive the speaker's delivery signals (per-channel summaries with stats, coarse timeline, and notable events), the full transcript, the speaker's planned material, and their audience/setting context.

Return ONLY JSON matching the provided schema. Produce:
- summary: a 2-3 sentence overall read of the delivery, specific to this rehearsal.
- prioritizedAdvice: the most important changes first (priority 1 = most important). Each item has a short title, an actionable detail, and evidence[] citing channel ids (e.g. "audio.pace") or short transcript quotes.
- metrics: one readout per delivery signal present in the summaries, each with a concise value string and a verdict of good | watch | flag. Do not invent metrics for channels that are absent.
- coverage: judge the delivered transcript against the speaker's planned material and the audience/setting context — pointsCovered (planned points actually delivered), pointsMissed (planned points skipped), deviations[] (notable off-script tangents), and runningLong (true if the talk clearly over/under-ran the material).

Be concrete and tie advice to the audience and setting when relevant. If material or context is missing, base coverage on the transcript alone and say so in the summary. Never fabricate quotes or numbers.`;
