/**
 * Firebase Auth context (Google sign-in).
 *
 * use when: gating the app on a signed-in user or reading the current user. Wrap the tree in
 * <AuthProvider> (see main.tsx) and read state via `useAuth()`. The ID token itself is attached
 * to API requests in src/api/authedFetch.ts, not here.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase.js';

interface AuthState {
  user: User | null;
  /** True until the first auth-state callback resolves (avoids a login flash for returning users). */
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Returns its unsubscribe so StrictMode's double-mount doesn't leak a second listener.
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      signIn: async () => {
        await signInWithPopup(auth, googleProvider);
      },
      signOut: () => fbSignOut(auth),
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** use when: a component needs the signed-in user or sign-in/out actions. */
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
