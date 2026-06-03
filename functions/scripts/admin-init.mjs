import { cert, getApps, initializeApp } from "firebase-admin/app";

export function initAdmin() {
  if (getApps().length) return;
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) {
    initializeApp({ credential: cert(JSON.parse(rawJson)) });
    return;
  }
  initializeApp();
}
