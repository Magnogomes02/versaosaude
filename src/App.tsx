import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { lazy, Suspense } from "react";
import type { ReactElement } from "react";
import {
  Activity,
  CalendarDays,
  ClipboardList,
  CreditCard,
  DoorOpen,
  FileText,
  LayoutDashboard,
  LogOut,
  Settings,
  Stethoscope,
  Users,
} from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { LoginPage } from "@/pages/LoginPage";

const AuditPage = lazy(() => import("@/pages/AuditPage").then((m) => ({ default: m.AuditPage })));
const CalendarPage = lazy(() => import("@/pages/CalendarPage").then((m) => ({ default: m.CalendarPage })));
const ConflictsPage = lazy(() => import("@/pages/ConflictsPage").then((m) => ({ default: m.ConflictsPage })));
const ContractsPage = lazy(() => import("@/pages/ContractsPage").then((m) => ({ default: m.ContractsPage })));
const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const FinancePage = lazy(() => import("@/pages/FinancePage").then((m) => ({ default: m.FinancePage })));
const PreferencesPage = lazy(() => import("@/pages/PreferencesPage").then((m) => ({ default: m.PreferencesPage })));
const ProfessionalsPage = lazy(() => import("@/pages/ProfessionalsPage").then((m) => ({ default: m.ProfessionalsPage })));
const RoomsPage = lazy(() => import("@/pages/RoomsPage").then((m) => ({ default: m.RoomsPage })));

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/profissionais", label: "Profissionais", icon: Users },
  { to: "/salas", label: "Salas", icon: DoorOpen },
  { to: "/contratos", label: "Contratos", icon: FileText },
  { to: "/calendario", label: "Calendario", icon: CalendarDays },
  { to: "/conflitos", label: "Conflitos", icon: Activity },
  { to: "/financeiro", label: "Financeiro", icon: CreditCard },
  { to: "/preferencias", label: "Preferencias", icon: Settings },
  { to: "/auditoria", label: "Auditoria", icon: ClipboardList },
];

function Shell() {
  const { logout, role, user } = useAuth();
  const location = useLocation();
  const current = nav.find((item) => item.to === location.pathname)?.label ?? "Dashboard";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><Stethoscope size={20} /></span>
          <div>
            <strong>VersaoSaude</strong>
            <small>V2 Firebase</small>
          </div>
        </div>
        <nav className="nav-list">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
              <item.icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Operacao clinica</p>
            <h1>{current}</h1>
          </div>
          <div className="userbox">
            <span>{user?.email}</span>
            <strong>{role ?? "sem perfil"}</strong>
            <button className="icon-button" onClick={logout} title="Sair">
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <Suspense fallback={<section className="panel">Carregando tela...</section>}>
          <Routes>
            <Route index element={<DashboardPage />} />
            <Route path="profissionais" element={<ProfessionalsPage />} />
            <Route path="salas" element={<RoomsPage />} />
            <Route path="contratos" element={<ContractsPage />} />
            <Route path="calendario" element={<CalendarPage />} />
            <Route path="conflitos" element={<ConflictsPage />} />
            <Route path="financeiro" element={<FinancePage />} />
            <Route path="preferencias" element={<PreferencesPage />} />
            <Route path="auditoria" element={<AuditPage />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen">Carregando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={<RequireAuth><Shell /></RequireAuth>} />
    </Routes>
  );
}
