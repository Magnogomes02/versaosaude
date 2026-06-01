// /public/js/pages/login.js
import { auth } from '../app.firebase.js';
import {
  signInWithEmailAndPassword,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';

const $ = s => document.querySelector(s);
$('#y').textContent = new Date().getFullYear();
const statusEl = $('#status');

onAuthStateChanged(auth, (user) => {
  if (user) {
    statusEl.textContent = 'Autenticado ✅ redirecionando…';
    setTimeout(() => (location.href = 'index.html'), 600);
  } else {
    statusEl.textContent = 'Aguardando…';
  }
});

$('#formLogin').addEventListener('submit', async (e) => {
  e.preventDefault();
  statusEl.textContent = 'Validando…';
  const email = $('#email').value.trim();
  const pass  = $('#pass').value;

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    // o onAuthStateChanged faz o redirect
  } catch (err) {
    statusEl.textContent = traduzErro(err);
  }
});

function traduzErro(err){
  const code = err?.code || '';
  const map = {
    'auth/invalid-email': 'E-mail inválido.',
    'auth/user-disabled': 'Usuário desativado.',
    'auth/user-not-found': 'Usuário não encontrado.',
    'auth/wrong-password': 'Senha incorreta.',
    'auth/too-many-requests': 'Muitas tentativas. Tente mais tarde.',
    'auth/network-request-failed': 'Falha de rede. Verifique a conexão.'
  };
  return map[code] || `Erro ao entrar: ${code || err.message}`;
}