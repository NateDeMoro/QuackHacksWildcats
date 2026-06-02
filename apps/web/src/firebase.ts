/**
 * Firebase client init (web).
 *
 * use when: signing in or reading the current user / ID token. This config is the project's
 * PUBLIC web config (apiKey here is an app identifier, not a secret — access is gated by Firebase
 * Auth + Firestore security rules, not by hiding this). Committed deliberately; the app has no
 * `.env`. Switch to `VITE_FIREBASE_*` env vars only if a second environment is ever added.
 *
 * Does NOT touch Google data APIs directly — only Firebase Auth. All app data still flows through
 * the same-origin `/api/...` backend (see src/api/authedFetch.ts).
 */
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyCi8n7l26-L188oDHMHYs29CJAh1wH5qFs',
  authDomain: 'speakeasy-498118.firebaseapp.com',
  projectId: 'speakeasy-498118',
  storageBucket: 'speakeasy-498118.firebasestorage.app',
  messagingSenderId: '848778281032',
  appId: '1:848778281032:web:59f793ad2df3122666987d',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
