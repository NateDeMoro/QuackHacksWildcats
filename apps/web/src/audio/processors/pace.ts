import type { ScalarSample } from '@quack/shared';
import type { AudioFrame, SignalProcessor } from '../types.js';
import { frameRms, toDbfs } from './volume.js';
import {
  PACE_EMIT_INTERVAL_MS as EMIT_INTERVAL_MS,
  DEFAULT_PACE_WINDOW_MS,
  PACE_FAST_ALPHA as FAST_ALPHA,
  PACE_SLOW_ALPHA as SLOW_ALPHA,
  PACE_ONSET_FACTOR as ONSET_FACTOR,
  PACE_SPEECH_GATE_DBFS as SPEECH_GATE_DBFS,
  PACE_MIN_ONSET_GAP_MS as MIN_ONSET_GAP_MS,
  PACE_SPS_SMOOTH_ALPHA as SPS_SMOOTH_ALPHA,
} from '../../config.js';

export { DEFAULT_PACE_WINDOW_MS };

/**
 * Crude speaking-pace proxy on channel `audio.pace` (syllables/sec). Detects energy onsets as
 * a stand-in for syllables, using a FAST envelope vs a SLOW baseline so the threshold doesn't
 * rise with the voice (which previously under-counted continuous speech). An absolute dBFS gate
 * suppresses onsets during silence. NOTE: rough proxy — the absolute rate is device-dependent
 * (the dashboard buckets it into slow/good/fast); accurate WPM arrives with STT in Stage 1.
 */
export class PaceProcessor implements SignalProcessor {
  readonly descriptor = {
    id: 'audio.pace',
    modality: 'audio' as const,
    signal: 'pace',
    unit: 'sps',
    sampleHz: 1000 / EMIT_INTERVAL_MS,
  };

  lastSps = 0;
  /** Sliding-window length for the rate estimate; adjustable live for tuning. */
  windowMs = DEFAULT_PACE_WINDOW_MS;
  private fastEnv = 0;
  private slowEnv = 0;
  private prevAbove = false;
  private onsets: number[] = [];
  private lastOnsetMs = -Infinity;
  private lastEmitMs = -Infinity;

  process(frame: AudioFrame): ScalarSample[] {
    const rms = frameRms(frame.time);
    this.fastEnv += FAST_ALPHA * (rms - this.fastEnv);
    this.slowEnv += SLOW_ALPHA * (rms - this.slowEnv);

    const voiced = toDbfs(rms) > SPEECH_GATE_DBFS;
    const above = voiced && this.fastEnv > this.slowEnv * ONSET_FACTOR;
    if (above && !this.prevAbove && frame.tMs - this.lastOnsetMs >= MIN_ONSET_GAP_MS) {
      this.onsets.push(frame.tMs);
      this.lastOnsetMs = frame.tMs;
    }
    this.prevAbove = above;

    // drop onsets outside the sliding window
    const cutoff = frame.tMs - this.windowMs;
    while (this.onsets.length > 0 && this.onsets[0]! < cutoff) this.onsets.shift();

    const windowSec = Math.max(1, Math.min(this.windowMs, frame.tMs)) / 1000;
    const rawSps = this.onsets.length / windowSec;
    this.lastSps += SPS_SMOOTH_ALPHA * (rawSps - this.lastSps);

    if (frame.tMs - this.lastEmitMs < EMIT_INTERVAL_MS) return [];
    this.lastEmitMs = frame.tMs;
    return [{ t: frame.tMs, v: this.lastSps }];
  }

  reset(): void {
    this.lastSps = 0;
    this.fastEnv = 0;
    this.slowEnv = 0;
    this.prevAbove = false;
    this.onsets = [];
    this.lastOnsetMs = -Infinity;
    this.lastEmitMs = -Infinity;
  }
}
