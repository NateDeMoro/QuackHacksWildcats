import type { AggregateReport, ChannelSummary, Transcript } from '@quack/shared';
import {
  PACE_SLOW_MAX_SPS,
  PACE_FAST_MIN_SPS,
  PACE_WPM_SLOW_MAX,
  PACE_WPM_FAST_MIN,
  PITCH_MONOTONE_MAX_HZ,
  PITCH_VARIED_MAX_HZ,
} from '@quack/shared';
import { VOL_FLOOR_DB, VOL_CEIL_DB, VOL_TOO_QUIET_FRAC, VOL_TOO_LOUD_FRAC } from '../config.js';
import './report.css';

/** Find a summary by its signal name (modality-agnostic). */
function findSig(summaries: ChannelSummary[], signal: string): ChannelSummary | undefined {
  return summaries.find((s) => s.descriptor.signal === signal);
}

type Verdict = 'good' | 'watch' | 'flag';
const VERDICT_COLOR: Record<Verdict, string> = {
  good: 'var(--c-meter-good)',
  watch: 'var(--c-meter-watch)',
  flag: 'var(--c-meter-flag)',
};

interface Metric {
  label: string;
  /** The glanceable category (e.g. "Too slow", "Good") for graded signals, else the raw value. */
  value: string;
  /** Specific reading (e.g. "1.8 syll/s") surfaced on hover for graded signals. */
  detail?: string;
  verdict?: Verdict;
}

/**
 * Real delivery metrics from the on-device channel summaries (not Gemini). `omitPace` drops the
 * coarse syllable-onset pace card when the STT transcript is available — the per-quarter WPM
 * timeline (PaceTimeline) replaces it.
 */
function deliveryMetrics(summaries: ChannelSummary[], omitPace = false): Metric[] {
  const metrics: Metric[] = [];

  const volume = findSig(summaries, 'volume');
  if (volume) {
    const dbfs = volume.stats['mean'] ?? 0;
    const frac = (dbfs - VOL_FLOOR_DB) / (VOL_CEIL_DB - VOL_FLOOR_DB);
    const category =
      frac < VOL_TOO_QUIET_FRAC ? 'Too quiet' : frac > VOL_TOO_LOUD_FRAC ? 'Too loud' : 'Good';
    const verdict: Verdict =
      frac < VOL_TOO_QUIET_FRAC ? 'watch' : frac > VOL_TOO_LOUD_FRAC ? 'flag' : 'good';
    metrics.push({ label: 'Mean volume', value: category, detail: `${dbfs.toFixed(0)} dBFS`, verdict });
  }

  const pace = findSig(summaries, 'pace');
  if (pace && !omitPace) {
    const sps = pace.stats['mean'] ?? 0;
    const category = sps < PACE_SLOW_MAX_SPS ? 'Too slow' : sps > PACE_FAST_MIN_SPS ? 'Too fast' : 'Good';
    const verdict: Verdict = sps < PACE_SLOW_MAX_SPS ? 'watch' : sps > PACE_FAST_MIN_SPS ? 'flag' : 'good';
    metrics.push({ label: 'Pace', value: category, detail: `${sps.toFixed(1)} syll/s`, verdict });
  }

  const pitch = findSig(summaries, 'pitch');
  if (pitch) {
    const varHz = pitch.stats['std'] ?? 0;
    const category =
      varHz < PITCH_MONOTONE_MAX_HZ ? 'Monotone' : varHz < PITCH_VARIED_MAX_HZ ? 'Good' : 'Expressive';
    const verdict: Verdict = varHz < PITCH_MONOTONE_MAX_HZ ? 'watch' : 'good';
    metrics.push({ label: 'Pitch variation', value: category, detail: `${varHz.toFixed(0)} Hz`, verdict });
  }

  const pause = findSig(summaries, 'pause');
  if (pause) metrics.push({ label: 'Pauses', value: `${pause.stats['count'] ?? 0}` });

  const filler = findSig(summaries, 'filler');
  if (filler) {
    const count = filler.stats['count'] ?? 0;
    metrics.push({ label: 'Filler words', value: `${count}`, verdict: count > 4 ? 'watch' : 'good' });
  }

  return metrics;
}

// --- transcript-derived pace (real WPM, chunked over time) ----------------------

/** A verdict for a words/min rate, from the shared STT pace bands. */
function wpmVerdict(wpm: number): { category: string; verdict: Verdict } {
  if (wpm < PACE_WPM_SLOW_MAX) return { category: 'Too slow', verdict: 'watch' };
  if (wpm > PACE_WPM_FAST_MIN) return { category: 'Too fast', verdict: 'flag' };
  return { category: 'Good', verdict: 'good' };
}

interface PaceQuarter {
  /** 0..3. */
  index: number;
  /** Talk-relative window, ms (quarter 0 starts at 0). */
  startMs: number;
  endMs: number;
  wpm: number | null;
  category: string;
  verdict?: Verdict;
}

interface PaceBreakdown {
  quarters: PaceQuarter[];
  avgWpm: number;
}

/** mm:ss for a talk-relative offset. */
function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Split the transcript into 4 equal-duration quarters of the spoken span and compute real WPM
 * per quarter (content words only — disfluencies excluded). Returns null for clips too short to
 * chunk meaningfully, so the caller falls back to the onset-proxy pace card.
 */
function paceBreakdown(transcript: Transcript): PaceBreakdown | null {
  const words = transcript.words.filter((w) => !w.isDisfluency && w.tEndMs > w.tStartMs);
  if (words.length < 8) return null;

  const t0 = words[0]!.tStartMs;
  const t1 = words[words.length - 1]!.tEndMs;
  const span = t1 - t0;
  if (span <= 0) return null;
  const chunk = span / 4;

  const quarters: PaceQuarter[] = [];
  for (let i = 0; i < 4; i++) {
    const absStart = t0 + i * chunk;
    const absEnd = i === 3 ? t1 : t0 + (i + 1) * chunk;
    const count = words.filter((w) => {
      const mid = (w.tStartMs + w.tEndMs) / 2;
      return mid >= absStart && (i === 3 ? mid <= absEnd : mid < absEnd);
    }).length;
    const minutes = (absEnd - absStart) / 60000;
    const wpm = minutes > 0 && count > 0 ? count / minutes : null;
    quarters.push(
      wpm === null
        ? { index: i, startMs: i * chunk, endMs: (i + 1) * chunk, wpm: null, category: '—' }
        : { index: i, startMs: i * chunk, endMs: (i + 1) * chunk, wpm, ...wpmVerdict(wpm) },
    );
  }

  return { quarters, avgWpm: words.length / (span / 60000) };
}

export interface ReportProps {
  summaries: ChannelSummary[] | null;
  transcript: Transcript | undefined;
  report: AggregateReport | null;
  reportPending: boolean;
  transcribing: boolean;
}

/**
 * Post-session report. Renders identically for a just-finished rehearsal and a stored one from
 * history (both supply summaries + transcript + report). Delivery-metric cards and the transcript
 * (with filler highlighting) are real (local summaries / Stage-1 STT); the context-aware advice
 * card is real (the Gemini report). Emphasis-vs-meaning and tone–content mismatch are
 * clearly-labeled Stage 3 placeholders.
 */
export function Report({ summaries, transcript, report, reportPending, transcribing }: ReportProps) {
  const pace = transcript ? paceBreakdown(transcript) : null;
  const metrics = summaries ? deliveryMetrics(summaries, !!pace) : [];
  const coverage = report?.coverage;
  const fillerCount = transcript?.words.filter((w) => w.isDisfluency).length ?? 0;

  return (
    <div className="report">
      <h2 className="report__heading">Delivery</h2>
      {pace && <PaceTimeline breakdown={pace} />}
      <div className="report__metrics">
        {metrics.map((m) => (
          <div className="card metric" key={m.label}>
            <p className="card__label">{m.label}</p>
            <div className="metric__row">
              {m.verdict && (
                <span className="metric__dot" style={{ backgroundColor: VERDICT_COLOR[m.verdict] }} />
              )}
              {m.detail ? (
                <span className="metric__value metric__value--category" tabIndex={0}>
                  {m.value}
                  <span className="metric__detail" role="tooltip">
                    {m.detail}
                  </span>
                </span>
              ) : (
                <span className="metric__value">{m.value}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {transcribing ? (
        <div className="card transcript">
          <p className="card__label">Transcript</p>
          <p className="card__hint">Transcribing your rehearsal…</p>
        </div>
      ) : (
        transcript && (
          <div className="card transcript">
            <p className="card__label">
              Transcript · {fillerCount} filler{fillerCount === 1 ? '' : 's'}
            </p>
            {transcript.words.length === 0 ? (
              <p className="card__hint">No speech detected in the recording.</p>
            ) : (
              <p className="transcript__text">
                {transcript.words.map((w, i) => (
                  <span key={i} className={w.isDisfluency ? 'filler-word' : undefined}>
                    {w.text}{' '}
                  </span>
                ))}
              </p>
            )}
          </div>
        )
      )}

      <div className="card advice">
        <p className="card__label">Context-aware advice</p>
        {transcribing || reportPending ? (
          <p className="card__hint">
            {transcribing ? 'Transcribing your rehearsal…' : 'Analyzing delivery against your material…'}
          </p>
        ) : !report ? (
          <p className="card__hint">Report unavailable.</p>
        ) : (
          <>
            <p className="advice__summary">{report.summary}</p>

            {report.prioritizedAdvice.length > 0 && (
              <ol className="advice__list">
                {report.prioritizedAdvice.map((a, i) => (
                  <li key={i} className="advice__item">
                    <span className="advice__title">{a.title}</span>
                    <span className="advice__detail">{a.detail}</span>
                    {a.evidence && a.evidence.length > 0 && (
                      <span className="advice__evidence">{a.evidence.join(' · ')}</span>
                    )}
                  </li>
                ))}
              </ol>
            )}

            {coverage && (
              <div className="coverage">
                {coverage.pointsCovered.length > 0 && (
                  <CoverageList title="Covered" tone="good" items={coverage.pointsCovered} />
                )}
                {coverage.pointsMissed.length > 0 && (
                  <CoverageList title="Missed" tone="flag" items={coverage.pointsMissed} />
                )}
                {coverage.deviations && coverage.deviations.length > 0 && (
                  <CoverageList title="Off-script" tone="watch" items={coverage.deviations} />
                )}
                {coverage.runningLong && (
                  <p className="card__hint">Ran notably long vs. the planned material.</p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <PlaceholderCard
        label="Emphasis vs. meaning"
        blurb="Did you vocally stress the words that carry the point? Lands with Gemini + alignment (Stage 3)."
      />
      <PlaceholderCard
        label="Tone–content mismatch"
        blurb="Content sentiment vs. delivered prosody — e.g. an exciting result delivered flat (Stage 3)."
      />
    </div>
  );
}

/**
 * Real pace, split into 4 equal-duration quarters of the talk so the arc is visible (e.g. fast
 * out of the gate, settling after). Each quarter shows its verdict; hover/focus reveals the WPM
 * and the time window.
 */
function PaceTimeline({ breakdown }: { breakdown: PaceBreakdown }) {
  return (
    <div className="card pace">
      <p className="card__label">Pace over time · {Math.round(breakdown.avgWpm)} wpm avg</p>
      <div className="pace__quarters">
        {breakdown.quarters.map((q) => (
          <div className="pace__quarter" key={q.index} tabIndex={0}>
            <span
              className="pace__bar"
              style={{ backgroundColor: q.verdict ? VERDICT_COLOR[q.verdict] : 'var(--c-hairline-strong)' }}
            />
            <span className="pace__cat">{q.category}</span>
            <span className="pace__detail" role="tooltip">
              {q.wpm !== null ? `${Math.round(q.wpm)} wpm` : 'no speech'} · {fmtClock(q.startMs)}–
              {fmtClock(q.endMs)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CoverageList({ title, tone, items }: { title: string; tone: Verdict; items: string[] }) {
  return (
    <div className="coverage__group">
      <span className="coverage__title" style={{ color: VERDICT_COLOR[tone] }}>
        {title}
      </span>
      <ul className="coverage__items">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function PlaceholderCard({ label, blurb }: { label: string; blurb: string }) {
  return (
    <div className="card placeholder">
      <p className="card__label">
        {label} <span className="placeholder__tag">coming soon</span>
      </p>
      <p className="card__hint">{blurb}</p>
    </div>
  );
}
