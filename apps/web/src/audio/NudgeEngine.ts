/**
 * Single calm nudge. The dashboard shows at most one short coaching line at a time; this engine
 * keeps it calm with hysteresis: a condition must hold for SUSTAIN_MS before a nudge appears, the
 * nudge persists while that condition lasts (it never switches mid-issue or stacks), and after it
 * clears there is a COOLDOWN_MS quiet gap before the next one. MAX_SHOW_MS caps nagging.
 *
 * use when: driving the live nudge from the capture loop. Stage 1 rules read audio signals only —
 * fillers are post-hoc this phase, so they are not a live nudge source yet.
 */

import {
  PACE_IDLE_MAX_SPS as PACE_IDLE,
  PACE_SLOW_MAX_SPS as PACE_SLOW,
  PACE_FAST_MIN_SPS as PACE_FAST,
  PITCH_MONOTONE_MAX_HZ as MONOTONE_HZ,
} from '@quack/shared';
import {
  NUDGE_SUSTAIN_MS as SUSTAIN_MS,
  NUDGE_COOLDOWN_MS as COOLDOWN_MS,
  NUDGE_MAX_SHOW_MS as MAX_SHOW_MS,
  NUDGE_QUIET_DBFS as QUIET_DBFS,
  NUDGE_DEAD_AIR_MS as DEAD_AIR_MS,
} from '../config.js';

/** Live values the nudge rules read. Mirrors the speaking-relevant LiveSnapshot fields. */
export interface NudgeInputs {
  tMs: number;
  volumeDbfs: number;
  paceSps: number;
  deadAirMs: number;
  pitchVarHz: number;
}

interface Rule {
  id: string;
  message: string;
  test: (i: NudgeInputs) => boolean;
}

// Priority order: earlier wins when several conditions qualify at once.
const RULES: Rule[] = [
  { id: 'deadair', message: 'Take it — then pick the thread back up.', test: (i) => i.deadAirMs > DEAD_AIR_MS },
  { id: 'fast', message: 'Ease off the pace a little.', test: (i) => i.paceSps > PACE_FAST },
  { id: 'quiet', message: 'Project a bit more.', test: (i) => i.paceSps >= PACE_IDLE && i.volumeDbfs < QUIET_DBFS },
  { id: 'monotone', message: 'Add some vocal variety.', test: (i) => i.paceSps >= PACE_IDLE && i.pitchVarHz > 0 && i.pitchVarHz < MONOTONE_HZ },
  { id: 'slow', message: 'You can lift the pace.', test: (i) => i.paceSps >= PACE_IDLE && i.paceSps < PACE_SLOW },
];

export class NudgeEngine {
  private activeSince = new Map<string, number>();
  private current: { id: string; message: string; shownAt: number } | null = null;
  private cooldownUntil = 0;

  /** Feed the latest signals; returns the nudge to display, or null. */
  update(i: NudgeInputs): string | null {
    for (const rule of RULES) {
      if (rule.test(i)) {
        if (!this.activeSince.has(rule.id)) this.activeSince.set(rule.id, i.tMs);
      } else {
        this.activeSince.delete(rule.id);
      }
    }

    // Hold the current nudge while its condition persists and it hasn't overstayed.
    if (this.current) {
      const stillActive = this.activeSince.has(this.current.id);
      const overstayed = i.tMs - this.current.shownAt > MAX_SHOW_MS;
      if (stillActive && !overstayed) return this.current.message;
      this.current = null;
      this.cooldownUntil = i.tMs + COOLDOWN_MS;
    }

    if (i.tMs < this.cooldownUntil) return null;

    for (const rule of RULES) {
      const since = this.activeSince.get(rule.id);
      if (since !== undefined && i.tMs - since >= SUSTAIN_MS) {
        this.current = { id: rule.id, message: rule.message, shownAt: i.tMs };
        return this.current.message;
      }
    }
    return null;
  }

  reset(): void {
    this.activeSince.clear();
    this.current = null;
    this.cooldownUntil = 0;
  }
}
