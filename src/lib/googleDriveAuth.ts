import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Access token is stored strictly in memory for the current session (never localStorage/sessionStorage).
let inMemoryDriveAccessToken: string | null = null;
let authListenerAttached = false;

function getFirebaseAuth(): Auth {
  let app: FirebaseApp;
  if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0];
  }
  const auth = getAuth(app);
  if (!authListenerAttached) {
    authListenerAttached = true;
    onAuthStateChanged(auth, (user) => {
      if (!user) {
        inMemoryDriveAccessToken = null;
      }
    });
  }
  return auth;
}

export function getInMemoryDriveToken(): string | null {
  return inMemoryDriveAccessToken;
}

export async function signInWithGoogleDrive(): Promise<{
  accessToken: string;
  email: string | null;
  displayName: string | null;
}> {
  const auth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive.readonly');
  provider.setCustomParameters({
    prompt: 'consent',
    access_type: 'online',
  });

  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const token = credential?.accessToken;

  if (!token) {
    throw new Error(
      'Google OAuth succeeded, but no Drive access token was returned. Please retry and grant Drive access.',
    );
  }

  inMemoryDriveAccessToken = token;
  return {
    accessToken: token,
    email: result.user.email,
    displayName: result.user.displayName,
  };
}

export async function signOutGoogleDrive(): Promise<void> {
  inMemoryDriveAccessToken = null;
  try {
    const auth = getFirebaseAuth();
    await signOut(auth);
  } catch {
    // ignore sign-out errors if auth was not initialized
  }
}
