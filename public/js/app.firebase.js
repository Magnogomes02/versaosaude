// app.firebase.js
import { FIREBASE_CONFIG } from './app.config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.projectId) {
  throw new Error('FIREBASE_CONFIG ausente ou incompleto (defina em app.config.js).');
}

export const app  = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db   = getFirestore(app);

// Persistência local
setPersistence(auth, browserLocalPersistence).catch(() => {});

// Expor no DevTools
window.app  = app;
window.auth = auth;
window.db   = db;

// Feedback de status
onAuthStateChanged(auth, (user) => {
  const badge = document.querySelector('[data-status], #appStatus'); // cobre ambos
  if (badge) badge.textContent = user ? 'Logado' : 'Não autenticado';

  // alterna visibilidade dos botões do header
  const btnLogin  = document.querySelector('[data-login]');
  const btnLogout = document.querySelector('[data-logout]');
  if (btnLogin)  btnLogin.hidden  = !!user;
  if (btnLogout) btnLogout.hidden = !user;
});