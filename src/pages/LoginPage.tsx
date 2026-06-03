import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";

export function LoginPage() {
  const { login, user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  if (!loading && user) return <Navigate to="/" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nao foi possivel entrar.");
    }
  }

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={submit}>
        <span className="brand-mark large"><ShieldCheck size={28} /></span>
        <h1>VersaoSaude</h1>
        <p>Acesse a gestao de contratos, agenda e financeiro.</p>
        <label>
          Email
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Senha
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="alert danger">{error}</div>}
        <button className="primary-button" type="submit">Entrar</button>
      </form>
    </main>
  );
}
