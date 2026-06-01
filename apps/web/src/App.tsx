import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechContext } from '@quack/shared';
import './dashboard/dashboard.css';
import { useAudioCapture } from './audio/useAudioCapture.js';
import { Dashboard } from './dashboard/Dashboard.js';
import { Report } from './report/Report.js';
import { ContextForm } from './context/ContextForm.js';
import { History } from './history/History.js';
import { AudioCoachControl } from './coach/AudioCoachControl.js';
import {
  fetchLatestContext,
  fetchSession,
  fetchSessions,
  type SessionListItem,
  type StoredSession,
} from './history/sessions.js';
import { useAuth } from './auth/AuthProvider.js';

type Phase = 'idle' | 'live' | 'report' | 'history';

export function App() {
  const { user, loading, signIn, signOut } = useAuth();
  const { transcribing, error, snapshot, summaries, record, report, reportPending, start, stop, onAutoStop } =
    useAudioCapture();
  const [phase, setPhase] = useState<Phase>('idle');
  const contextRef = useRef<SpeechContext>({});

  // "Reuse last request": prefill the context form from the user's most recent stored session.
  // `formKey` remounts ContextForm so the new `prefill` re-seeds its internal state.
  const [prefill, setPrefill] = useState<SpeechContext | undefined>(undefined);
  const [formKey, setFormKey] = useState(0);
  const [reuseLoading, setReuseLoading] = useState(false);
  const [reuseError, setReuseError] = useState<string | null>(null);

  // History (past rehearsals) + the stored session currently being viewed, if any.
  const [items, setItems] = useState<SessionListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [viewed, setViewed] = useState<StoredSession | null>(null);

  // Set when an /api call 403s (account not on the allowlist) → we sign out and explain the gate.
  const [authzError, setAuthzError] = useState(false);

  const onStart = () => {
    setViewed(null);
    setPrefill(undefined);
    setReuseError(null);
    start();
    setPhase('live');
  };

  const reuseLast = async () => {
    setReuseError(null);
    setReuseLoading(true);
    try {
      const ctx = await fetchLatestContext();
      if (!ctx) {
        setReuseError('No previous rehearsal to reuse');
        return;
      }
      contextRef.current = ctx;
      setPrefill(ctx);
      setFormKey((k) => k + 1);
    } catch (e: unknown) {
      setReuseError(e instanceof Error ? e.message : 'Could not load last request');
    } finally {
      setReuseLoading(false);
    }
  };

  const onStop = useCallback(() => {
    stop(contextRef.current);
    setPhase('report');
  }, [stop]);

  // The 10-min auto-stop should behave exactly like clicking Stop (finalize + go to the report).
  useEffect(() => onAutoStop(onStop), [onAutoStop, onStop]);

  // A 403 from any /api call means the signed-in account isn't on the allowlist: explain the gate
  // and sign out, instead of leaving a raw "(403)" error on screen.
  useEffect(() => {
    if (authzError) return;
    if ([error, historyError, reuseError].some((m) => m && /account not authorized|\(403\)/.test(m))) {
      setAuthzError(true);
      void signOut();
    }
  }, [error, historyError, reuseError, signOut, authzError]);

  const openHistory = useCallback(async () => {
    setViewed(null);
    setPhase('history');
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setItems(await fetchSessions());
    } catch (e: unknown) {
      setHistoryError(e instanceof Error ? e.message : 'Could not load history');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const onSelectSession = useCallback(async (id: string) => {
    setHistoryError(null);
    try {
      setViewed(await fetchSession(id));
      setPhase('report');
    } catch (e: unknown) {
      setHistoryError(e instanceof Error ? e.message : 'Could not load rehearsal');
    }
  }, []);

  const newRehearsal = () => {
    setViewed(null);
    setPrefill(undefined);
    setReuseError(null);
    setPhase('idle');
  };

  // Auth gate: nothing renders until a Google user is signed in (history is stored per user).
  if (loading) {
    return (
      <div className="app">
        <p className="app__subtitle">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app">
        <h1 className="app__title">SpeakEasy</h1>
        <p className="app__subtitle">
          Sign in to rehearse and keep your practice history. Volume, pace, pitch, and dead air are
          tracked live with a single calm nudge; a full context-aware report comes after you stop.
        </p>
        <div className="controls">
          <button className="btn btn--primary" onClick={() => void signIn()}>
            Sign in with Google
          </button>
        </div>
        {authzError && (
          <p className="error">
            That account isn’t authorized for SpeakEasy. Contact the organizer to be added.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">SpeakEasy</h1>
        <div className="app__account">
          {user.email && (
            <span className="app__email" title={user.email}>
              {user.email}
            </span>
          )}
          <button className="btn btn--ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {phase === 'idle' && (
        <>
          <p className="app__subtitle">
            Set the scene, then rehearse. Volume, pace, pitch, and dead air are tracked live with a
            single calm nudge; the full context-aware report comes after you stop.
          </p>
          <ContextForm
            key={formKey}
            initialContext={prefill}
            onChange={(ctx) => (contextRef.current = ctx)}
          />
          <AudioCoachControl />
          <div className="controls">
            <button className="btn btn--primary" onClick={onStart}>
              Start rehearsal
            </button>
            <button
              className="btn btn--ghost"
              onClick={() => void reuseLast()}
              disabled={reuseLoading}
            >
              {reuseLoading ? 'Loading…' : 'Reuse last request'}
            </button>
            <button className="btn btn--ghost" onClick={openHistory}>
              History
            </button>
            {reuseError && <span className="error">{reuseError}</span>}
          </div>
        </>
      )}

      {phase === 'live' && (
        <>
          <div className="controls">
            <button className="btn btn--ghost" onClick={onStop}>
              Stop
            </button>
            {error && <span className="error">{error}</span>}
          </div>
          <AudioCoachControl />
          <Dashboard snapshot={snapshot} />
        </>
      )}

      {phase === 'history' && (
        <>
          <div className="controls">
            <button className="btn btn--primary" onClick={newRehearsal}>
              New rehearsal
            </button>
          </div>
          <History items={items} loading={historyLoading} error={historyError} onSelect={onSelectSession} />
        </>
      )}

      {phase === 'report' && (
        <>
          <div className="controls">
            <button className="btn btn--primary" onClick={newRehearsal}>
              New rehearsal
            </button>
            <button className="btn btn--ghost" onClick={openHistory}>
              {viewed ? 'Back to history' : 'History'}
            </button>
            {error && <span className="error">{error}</span>}
          </div>
          <Report
            summaries={viewed ? viewed.channelSummaries : summaries}
            transcript={viewed ? viewed.transcript : record?.transcript}
            report={viewed ? viewed.report : report}
            reportPending={viewed ? false : reportPending}
            transcribing={viewed ? false : transcribing}
            durationMs={viewed ? viewed.durationMs : record?.durationMs ?? null}
            goalSeconds={
              viewed
                ? viewed.context?.settings?.goalSeconds
                : contextRef.current.settings?.goalSeconds
            }
          />
        </>
      )}
    </div>
  );
}
