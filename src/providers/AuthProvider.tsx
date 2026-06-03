import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { UserRole } from "@/types";

interface AuthContextValue {
  user: User | null;
  role: UserRole | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isGestor: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setRole(null);
        setLoading(false);
        return;
      }
      const roleSnap = await getDoc(doc(db, "user_roles", nextUser.uid));
      setRole((roleSnap.data()?.role as UserRole | undefined) ?? "visualizador");
      setLoading(false);
    });
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    role,
    loading,
    isGestor: role === "owner" || role === "gestor",
    login: async (email, password) => {
      await signInWithEmailAndPassword(auth, email, password);
    },
    logout: () => signOut(auth),
  }), [loading, role, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
