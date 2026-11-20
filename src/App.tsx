import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { RequireAuth, RequireRole } from "./auth/RequireAuth";
import { homeFor, STAFF } from "./lib/roles";
import AppLayout from "./layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Portal from "./pages/Portal";
import ResetPassword from "./pages/ResetPassword";
import { Projects } from "./pages/Sections";
import BidDetail from "./pages/bids/BidDetail";
import BidForm from "./pages/bids/BidForm";
import BidList from "./pages/bids/BidList";
import ClientDetail from "./pages/clients/ClientDetail";
import ClientForm from "./pages/clients/ClientForm";
import ClientList from "./pages/clients/ClientList";
import SubcontractorDetail from "./pages/subcontractors/SubcontractorDetail";
import SubcontractorForm from "./pages/subcontractors/SubcontractorForm";
import SubcontractorList from "./pages/subcontractors/SubcontractorList";
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
                <Route path="/bids" element={<BidList />} />
                <Route path="/bids/nuevo" element={<BidForm />} />
                <Route path="/bids/:id" element={<BidDetail />} />
                <Route path="/bids/:id/editar" element={<BidForm />} />
                <Route path="/clientes" element={<ClientList />} />
                <Route path="/clientes/nuevo" element={<ClientForm />} />
                <Route path="/clientes/:id" element={<ClientDetail />} />
                <Route path="/clientes/:id/editar" element={<ClientForm />} />
                <Route path="/subcontratistas" element={<SubcontractorList />} />
                <Route path="/subcontratistas/nuevo" element={<SubcontractorForm />} />
                <Route path="/subcontratistas/:id" element={<SubcontractorDetail />} />
                <Route path="/subcontratistas/:id/editar" element={<SubcontractorForm />} />
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
