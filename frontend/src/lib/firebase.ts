import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  type User
} from 'firebase/auth';

// Firebase configuration using environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication
export const auth = getAuth(app);

// Initialize Google Auth Provider with custom parameters
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});
googleProvider.addScope('profile');
googleProvider.addScope('email');

// Auth error types for UI handling
export type AuthErrorType = 
  | 'popup-blocked'
  | 'popup-closed'
  | 'network-error'
  | 'cancelled'
  | 'unknown';

// Parse Firebase auth errors into user-friendly types
export function parseAuthError(error: unknown): { type: AuthErrorType; message: string } {
  const errorCode = (error as { code?: string })?.code || '';
  
  switch (errorCode) {
    case 'auth/popup-blocked':
      return {
        type: 'popup-blocked',
        message: 'The sign-in popup was blocked by your browser. Please allow popups for this site and try again.'
      };
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return {
        type: 'popup-closed',
        message: 'Sign-in was cancelled. Please try again when ready.'
      };
    case 'auth/network-request-failed':
      return {
        type: 'network-error',
        message: 'Network error. Please check your internet connection and try again.'
      };
    case 'auth/user-cancelled':
      return {
        type: 'cancelled',
        message: 'Sign-in was cancelled.'
      };
    default:
      return {
        type: 'unknown',
        message: 'An unexpected error occurred. Please try again.'
      };
  }
}

// Export auth functions for convenience
export {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  type User
};

export default app;
