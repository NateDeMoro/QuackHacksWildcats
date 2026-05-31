import type { ScalarSample } from '@quack/shared';
import { PitchDetector } from 'pitchy';
import type { AudioFrame, SignalProcessor } from '../types.js';
import {
  PITCH_EMIT_INTERVAL_MS as EMIT_INTERVAL_MS,
  PITCH_CLARITY_GATE as CLARITY_GATE,
  PITCH_MIN_HZ as MIN_HZ,
  PITCH_MAX_HZ as MAX_HZ,
  DEFAULT_PITCH_WINDOW_MS,
  PITCH_DISPLAY_ALPHA as DISPLAY_ALPHA,
  PITCH_VOICED_HOLD_MS as VOICED_HOLD_MS,
} from '../../config.js';

export { DEFAULT_PITCH_WINDOW_MS };

/**
 * Fundamental-frequency (pitch) on channel `audio.pitch` in Hz, via pitchy's McLeod detector.
 * Only voiced frames pass the clarity gate and the human-range band; unvoiced frames emit nothing
 * (so silence/consonants don't pollute the recorded series). `lastVarHz` (rolling std over the last
 * few seconds) feeds the variation/monotone proxy. The live `lastHz` is EMA-smoothed and held
 * briefly through short unvoiced gaps so the readout glides instead of flickering between syllables.
 */
export class PitchProcessor implements SignalProcessor {
  readonly descriptor = {
    id: 'audio.pitch',
    modality: 'audio' as const,
    signal: 'pitch',
    unit: 'hz',
    sampleHz: 1000 / EMIT_INTERVAL_MS,
  };

  /** Smoothed/held pitch in Hz for the live readout, or 0 when unvoiced past the hold window. */
  lastHz = 0;
  /** Std of recent voiced pitch (Hz) — the variation/monotone proxy. */
  lastVarHz = 0;
  /** Rolling window length for the variation std; adjustable live for tuning. */
  varWindowMs = DEFAULT_PITCH_WINDOW_MS;

  private detector?: PitchDetector<Float32Array>;
  private detectorLen = 0;
  private recent: { t: number; hz: number }[] = [];
  private lastEmitMs = -Infinity;
  private lastVoicedMs = -Infinity;

  process(frame: AudioFrame): ScalarSample[] {
    if (!this.detector || this.detectorLen !== frame.time.length) {
      this.detector = PitchDetector.forFloat32Array(frame.time.length);
      this.detectorLen = frame.time.length;
    }
    const [hz, clarity] = this.detector.findPitch(frame.time, frame.sampleRate);
    const voiced = clarity >= CLARITY_GATE && hz >= MIN_HZ && hz <= MAX_HZ;

    if (!voiced) {
      // Hold the last reading through brief gaps (consonants); only drop to 0 once the gap is real.
      if (frame.tMs - this.lastVoicedMs > VOICED_HOLD_MS) this.lastHz = 0;
      this.pruneAndScore(frame.tMs);
      return [];
    }

    // Snap on re-entry from silence, otherwise glide toward the detected pitch.
    this.lastHz = this.lastHz > 0 ? this.lastHz + DISPLAY_ALPHA * (hz - this.lastHz) : hz;
    this.lastVoicedMs = frame.tMs;
    this.recent.push({ t: frame.tMs, hz });
    this.pruneAndScore(frame.tMs);

    if (frame.tMs - this.lastEmitMs < EMIT_INTERVAL_MS) return [];
    this.lastEmitMs = frame.tMs;
    return [{ t: frame.tMs, v: hz, c: clarity }];
  }

  /** Drop samples outside the variation window and recompute `lastVarHz`. */
  private pruneAndScore(tMs: number): void {
    const cutoff = tMs - this.varWindowMs;
    while (this.recent.length > 0 && this.recent[0]!.t < cutoff) this.recent.shift();
    const n = this.recent.length;
    if (n < 2) {
      this.lastVarHz = 0;
      return;
    }
    const mean = this.recent.reduce((a, b) => a + b.hz, 0) / n;
    const variance = this.recent.reduce((a, b) => a + (b.hz - mean) ** 2, 0) / n;
    this.lastVarHz = Math.sqrt(variance);
  }

  reset(): void {
    this.lastHz = 0;
    this.lastVarHz = 0;
    this.detector = undefined;
    this.detectorLen = 0;
    this.recent = [];
    this.lastEmitMs = -Infinity;
    this.lastVoicedMs = -Infinity;
  }
}
