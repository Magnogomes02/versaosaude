// public/js/auth.js
// Handler específico da página de login.html
import { loginWithEmailPassword, requireAnon } from "./app.auth.js";

const form = document.getElementById("login-form");
const email = document.getElementById("login-email");
const pass = document.getElementById("login-password");
const msg  = document.getElementById("login-msg");

requireAnon(() => {
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";
    try {
      await loginWithEmailPassword(email.value.trim(), pass.value);
      // redireciona automático pelo guard de rota do index
      location.href = "./index.html";
    } catch (err) {
      msg.textContent = (err && err.message) ? err.message : String(err);
    }
  });
});