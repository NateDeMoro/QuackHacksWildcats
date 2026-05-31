/**
 * Batch Speech-to-Text: audio bytes → word-level `Transcript`.
 *
 * use when: the web client POSTs a recorded rehearsal clip to /api/transcribe.
 *
 * Disfluencies are tagged from a fixed lexicon rather than trusting STT's own filler handling,
 * which is unreliable across models/configs (the plan's flagged Stage 1 risk). Sync `recognize`
 * caps inline audio at ~60s — fine for short demo clips; full-length talks arrive with the
 * streaming path. When the Speech client is unavailable, returns a small mock transcript so the
 * rest of the app stays testable offline.
 */

import type { Transcript, TranscriptWord } from '@quack/shared';
import { getSpeechClient, loadGoogleConfig } from '../google/clients.js';
import { FILLER_WORDS, FILLER_BOOSTS, STT_MODEL } from '../config.js';

/** Normalize a token for lexicon lookup: lowercase, strip surrounding punctuation. */
function normalize(word: string): string {
  return word.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');
}

/** google.protobuf.Duration ({seconds, nanos}) → milliseconds. `seconds` may be number/string/Long. */
function durationToMs(d: { seconds?: unknown; nanos?: number | null } | null | undefined): number {
  if (!d) return 0;
  // Long stringifies to a numeric string; number/string pass through Number() directly.
  const seconds = Number(d.seconds == null ? 0 : (d.seconds as { toString(): string }).toString());
  return Math.round(seconds * 1000 + (d.nanos ?? 0) / 1e6);
}

function isFiller(text: string): boolean {
  return FILLER_WORDS.has(normalize(text));
}

/** Transcribe a recorded clip. `mimeType` is informational — STT auto-detects the encoding. */
export async function transcribe(audio: Uint8Array, _mimeType?: string): Promise<Transcript> {
  const client = getSpeechClient();
  if (!client) return mockTranscript();

  // Prefer the explicit project (GOOGLE_CLOUD_PROJECT) so we don't depend on metadata detection,
  // which fails locally without ADC. Falls back to the credential's own project id.
  const projectId = loadGoogleConfig().projectId ?? (await client.getProjectId());
  const [response] = await client.recognize({
    recognizer: `projects/${projectId}/locations/global/recognizers/_`,
    config: {
      autoDecodingConfig: {},
      model: STT_MODEL,
      languageCodes: ['en-US'],
      features: { enableWordTimeOffsets: true, enableAutomaticPunctuation: true },
      adaptation: {
        phraseSets: [{ inlinePhraseSet: { phrases: FILLER_BOOSTS } }],
      },
    },
    content: audio,
  });

  const words: TranscriptWord[] = [];
  const textParts: string[] = [];
  for (const result of response.results ?? []) {
    const alt = result.alternatives?.[0];
    if (!alt) continue;
    if (alt.transcript) textParts.push(alt.transcript.trim());
    for (const w of alt.words ?? []) {
      const text = w.word ?? '';
      if (!text) continue;
      words.push({
        text,
        tStartMs: durationToMs(w.startOffset),
        tEndMs: durationToMs(w.endOffset),
        isDisfluency: isFiller(text),
      });
    }
  }

  // Fall back to the joined alternatives when word offsets are absent.
  const text = textParts.join(' ').trim() || words.map((w) => w.text).join(' ');
  return { words, text };
}

/** Deterministic stand-in used when STT is disabled or unavailable. */
function mockTranscript(): Transcript {
  const seq: [string, number, number, boolean][] = [
    ['Thanks', 0, 400, false],
    ['everyone', 450, 900, false],
    ['um', 950, 1200, true],
    ['for', 1250, 1450, false],
    ['being', 1500, 1800, false],
    ['here', 1850, 2200, false],
  ];
  return {
    words: seq.map(([text, tStartMs, tEndMs, isDisfluency]) => ({ text, tStartMs, tEndMs, isDisfluency })),
    text: 'Thanks everyone um for being here',
  };
}
