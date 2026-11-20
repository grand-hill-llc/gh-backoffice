import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { RequireAuth, RequireRole } from "./auth/RequireAuth";
import { homeFor, STAFF } from "./lib/roles";
import AppLayout from "./layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Portal from "./pages/Portal";
import ResetPassword from "./pages/ResetPassword";
import { Bids, Clients, Projects, Subcontractors } from "./pages/Sections";
import Team from "./pages/Team";

function Home() {
  const { profile } = useAuth();
  return <Navigate to={profile ? homeFor(profile.role) : "/login"} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/restablecer" element={<ResetPassword />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route index element={<Home />} />

              <Route element={<RequireRole allow={STAFF} />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/bids" element={<Bids />} />
                <Route path="/clientes" element={<Clients />} />
                <Route path="/subcontratistas" element={<Subcontractors />} />
                <Route path="/proyectos" element={<Projects />} />
              </Route>

              <Route element={<RequireRole allow={["super_admin"]} />}>
                <Route path="/equipo" element={<Team />} />
              </Route>

              <Route element={<RequireRole allow={["subcontractor"]} />}>
                <Route path="/portal" element={<Portal />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
