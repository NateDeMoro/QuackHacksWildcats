import type { AggregateFn, AggregateInput, AggregateReport, MetricReadout } from '@quack/shared';
import { SCHEMA_VERSION, findSummary } from '@quack/shared';
import { Type } from '@google/genai';
import { getGeminiClient, loadGoogleConfig } from '../google/clients.js';
import { GEMINI_MODEL_DEFAULT, GEMINI_SYSTEM_INSTRUCTION } from '../config.js';

/**
 * Stage 2 aggregate: send the session's channel summaries, transcript, planned material, and
 * audience/setting context to Gemini (Vertex AI, JSON mode) for a context-aware delivery report.
 *
 * Degrades gracefully, like the STT path: when Gemini is disabled/unavailable, or returns
 * malformed JSON, it falls back to `stubReport` so the report is never empty. The deterministic
 * volume/pause metrics from `floorMetrics` are also used as a floor if the model omits metrics.
 * Modality-agnostic throughout (reads channels via `findSummary`).
 */
export const runAggregate: AggregateFn = async (input): Promise<AggregateReport> => {
  const client = getGeminiClient();
  if (!client) return stubReport(input);

  try {
    const res = await client.models.generateContent({
      model: loadGoogleConfig().geminiModel ?? GEMINI_MODEL_DEFAULT,
      contents: buildPrompt(input),
      config: {
        systemInstruction: GEMINI_SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: REPORT_SCHEMA,
        temperature: 0.4,
      },
    });
    const text = res.text;
    if (!text) throw new Error('empty Gemini response');
    const parsed = JSON.parse(text) as Omit<AggregateReport, 'schemaVersion'>;
    return {
      schemaVersion: SCHEMA_VERSION,
      summary: parsed.summary,
      // Floor: if the model returned no metrics, use the deterministic baseline.
      metrics: parsed.metrics?.length ? parsed.metrics : floorMetrics(input),
      prioritizedAdvice: parsed.prioritizedAdvice ?? [],
      coverage: parsed.coverage,
    };
  } catch (err) {
    console.error('[aggregate] Gemini call/parse failed, returning stub:', err);
    return stubReport(input);
  }
};

/** Serialize the aggregate input into a single prompt string for the report. */
function buildPrompt(input: AggregateInput): string {
  const parts: string[] = [];
  parts.push(`Session duration: ${(input.session.durationMs / 1000).toFixed(1)}s`);
  parts.push(`Captured modalities: ${input.session.capturedModalities.join(', ') || 'none'}`);
  parts.push(`Channel summaries (stats + timeline + events):\n${JSON.stringify(input.channelSummaries)}`);
  if (input.transcript?.text) parts.push(`Transcript:\n${input.transcript.text}`);
  if (input.speechMaterial?.combinedText) {
    parts.push(`Planned material:\n${input.speechMaterial.combinedText}`);
  }
  if (input.settings) {
    const s = input.settings;
    const lines = [
      s.audience && `Audience: ${s.audience}`,
      s.audienceSize && `Audience size: ${s.audienceSize}`,
      s.audienceBackground && `Audience background: ${s.audienceBackground}`,
      s.location && `Location: ${s.location}`,
      s.presentationType && `Presentation type: ${s.presentationType}`,
      s.notes && `Notes: ${s.notes}`,
    ].filter(Boolean);
    if (lines.length) parts.push(`Audience/setting:\n${lines.join('\n')}`);
  }
  return parts.join('\n\n');
}

/**
 * Deterministic volume/pause metrics — the floor so a bad LLM response never yields an empty
 * report. Reads channels via `findSummary` and degrades gracefully when a channel is absent.
 */
function floorMetrics(input: AggregateInput): MetricReadout[] {
  const volume = findSummary(input.channelSummaries, 'audio', 'volume');
  const pause = findSummary(input.channelSummaries, 'audio', 'pause');
  const metrics: MetricReadout[] = [];
  if (volume) {
    metrics.push({
      channelId: volume.descriptor.id,
      label: 'Mean volume',
      value: `${(volume.stats['mean'] ?? 0).toFixed(1)} dBFS`,
    });
  }
  if (pause) {
    metrics.push({
      channelId: pause.descriptor.id,
      label: 'Pauses',
      value: `${pause.stats['count'] ?? 0}`,
    });
  }
  return metrics;
}

/** Deterministic fallback used when Gemini is disabled or returns unusable output. */
function stubReport(input: AggregateInput): AggregateReport {
  return {
    schemaVersion: SCHEMA_VERSION,
    summary: 'Stub report — Gemini disabled or unavailable.',
    prioritizedAdvice: [],
    metrics: floorMetrics(input),
  };
}

/**
 * Response schema for JSON mode — the Stage-2 subset of AggregateReport only. Stage 3/4 fields
 * (emphasisVsMeaning, toneContentMismatch, congruence) are deliberately omitted, and
 * `schemaVersion` is attached server-side after parsing (the model never sets it).
 */
const REPORT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    prioritizedAdvice: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          priority: { type: Type.NUMBER },
          title: { type: Type.STRING },
          detail: { type: Type.STRING },
          evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['priority', 'title', 'detail'],
      },
    },
    metrics: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          channelId: { type: Type.STRING },
          label: { type: Type.STRING },
          value: { type: Type.STRING },
          verdict: { type: Type.STRING, enum: ['good', 'watch', 'flag'] },
        },
        required: ['channelId', 'label', 'value'],
      },
    },
    coverage: {
      type: Type.OBJECT,
      properties: {
        pointsCovered: { type: Type.ARRAY, items: { type: Type.STRING } },
        pointsMissed: { type: Type.ARRAY, items: { type: Type.STRING } },
        deviations: { type: Type.ARRAY, items: { type: Type.STRING } },
        runningLong: { type: Type.BOOLEAN },
      },
      required: ['pointsCovered', 'pointsMissed'],
    },
  },
  required: ['summary', 'prioritizedAdvice', 'metrics'],
};
