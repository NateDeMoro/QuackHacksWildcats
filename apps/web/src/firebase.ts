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
  apiKey: 'AIzaSyBb84DgpjgoHjkKjJI0Z1ItS8736niXRi0',
  authDomain: 'uoo-quackathon26eug-8210.firebaseapp.com',
  projectId: 'uoo-quackathon26eug-8210',
  storageBucket: 'uoo-quackathon26eug-8210.firebasestorage.app',
  messagingSenderId: '1046662941340',
  appId: '1:1046662941340:web:7478399e3828e324633b59',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
