# Versão Saúde — Atualização de autenticação, Firestore e páginas dinâmicas

Arquivos principais atualizados/criados:
- `firestore.rules`, `firebase.json`, `.firebaserc`
- `public/js/app.firebase.js` (init app/auth/db)
- `public/js/app.auth.js` (login/logout + guards)
- `public/js/auth.js` (handler login.html)
- `public/js/app.db.js` (helpers: settings, professionals, contracts, bookings)
- `public/js/pages/preferencias.js`, `contratos.js`, `calendario.js`, `conflitos.js`

**Importante nos HTMLs**:
- Carregar `app.config.js` antes de qualquer módulo Firebase.
- Usar scripts como ES Modules e caminhos relativos corretos:
  ```html
  <script src="./js/app.config.js"></script>
  <script type="module" src="./js/app.firebase.js"></script>
  <script type="module" src="./js/app.auth.js"></script>
  <!-- por página -->
  <script type="module" src="./js/pages/preferencias.js"></script>
  ```

**Login page (`login.html`)** carrega:
```
<script src="./js/app.config.js"></script>
<script type="module" src="./js/app.firebase.js"></script>
<script type="module" src="./js/app.auth.js"></script>
<script type="module" src="./js/auth.js"></script>
```

**Guard**: nas páginas internas, use `requireAuth` dentro do JS da página para redirecionar não autenticados para `login.html`.