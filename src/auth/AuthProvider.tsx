import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { Role } from "../lib/roles";

export type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: Role;
  subcontractor_id: string | null;
};

type ProfileState = { uid: string | null; profile: Profile | null; error: string | null };

type AuthState = {
  session: Session | null;
  /** The signed-in user's row in public.profiles. Null means the account has no access assigned. */
  profile: Profile | null;
  /** Set when the profile could not be read at all (for example the database migration is missing). */
  profileError: string | null;
  /** True until the session and its profile have both been resolved. */
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [state, setState] = useState<ProfileState>({ uid: null, profile: null, error: null });

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setSessionLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const uid = session?.user.id ?? null;

  useEffect(() => {
    if (!uid) {
      setState({ uid: null, profile: null, error: null });
      return;
    }
    let active = true;
    supabase
      .from("profiles")
      .select("id, full_name, email, role, subcontractor_id")
      .eq("id", uid)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        setState({ uid, profile: (data as Profile | null) ?? null, error: error ? error.message : null });
      });
    return () => {
      active = false;
    };
  }, [uid]);

  // The profile belongs to a different user (or none yet) until its uid matches the session's.
  const profileLoading = !!uid && state.uid !== uid;
  const loading = sessionLoading || profileLoading;

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        profile: profileLoading ? null : state.profile,
        profileError: profileLoading ? null : state.error,
        loading,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
