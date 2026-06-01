// /public/js/app.auth.js
import { auth, db } from './app.firebase.js';
import {
  signOut,
  onAuthStateChanged,
  getIdTokenResult
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// util: url do login relativa ao local atual (funciona em / e /public/)
function loginUrl() {
  try { return new URL('login.html', window.location.href).toString(); }
  catch { return 'login.html'; }
}
function isLoginPage() {
  return /(^|\/)login\.html(\?|#|$)/.test(location.pathname);
}

/** Abre a tela de login */
export function signInUI() {
  window.location.href = loginUrl();
}

/** Logout padrão do header */
export async function signOutUI() {
  try {
    await signOut(auth);
    window.location.href = loginUrl();
  } catch (e) {
    console.error('Falha no logout', e);
    alert('Erro ao sair. Tente novamente.');
  }
}

/** Conecta botões do header e status de auth */
export function bindAuthUI() {
  const yEl = document.getElementById('y');
  if (yEl) yEl.textContent = String(new Date().getFullYear());

  const btnLogin  = document.querySelector('[data-login]');
  const btnLogout = document.querySelector('[data-logout]');
  if (btnLogin)  btnLogin.addEventListener('click', signInUI);
  if (btnLogout) btnLogout.addEventListener('click', signOutUI);

  onAuthStateChanged(auth, (user) => {
    document.documentElement.dataset.auth = user ? 'on' : 'off';
    if (btnLogin)  btnLogin.hidden  = !!user;
    if (btnLogout) btnLogout.hidden = !user;
  });
}

/** Expõe auth/db no console para debug (conveniência) */
export function exposeAuthForConsole() {
  window.__auth = auth; window.auth = auth;
  window.__db   = db;   window.db   = db;
  console.info('Debug: use window.__auth/.__db (ou window.auth/window.db).');
}

/** Aguarda auth pronto e retorna o usuário (ou redireciona) */
export async function requireAuth(cbOrOpts) {
  const opts = (typeof cbOrOpts === 'function') ? {} : (cbOrOpts || {});
  const cb   = (typeof cbOrOpts === 'function') ? cbOrOpts : null;

  const user = await new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(u); });
  });

  if (!user) {
    const to = opts.redirectTo || loginUrl();
    // não redireciona se já estamos no login
    if (!isLoginPage() && to) window.location.href = to;
    return null;
  }

  if (cb) await cb(user);
  return user;
}

/** Lê claims do token (se existir) */
export async function getClaims() {
  const user = auth.currentUser || await requireAuth();
  const res = await getIdTokenResult(user, true);
  return res.claims || {};
}

/** Verifica papel do usuário em /user_roles/{uid}. Redireciona se não tiver. */
export async function requireRole(role = 'gestor', { onFail = 'redirect', redirectTo } = {}) {
  const user = await requireAuth({ redirectTo: redirectTo || loginUrl() });
  if (!user) return false;

  try {
    const snap = await getDoc(doc(db, 'user_roles', user.uid));
    const data = snap.exists() ? snap.data() : {};
    const ok = data.role === role;
    if (!ok && onFail === 'redirect') window.location.href = (redirectTo || '/');
    return ok;
  } catch (e) {
    console.error('Erro ao verificar papel:', e);
    if (onFail === 'redirect') window.location.href = (redirectTo || '/');
    return false;
  }
}