import { EmptyState, PageHeader } from "../components/ui";

export function Bids() {
  return (
    <>
      <PageHeader eyebrow="Ventas" title="Bids" description="Oportunidades de licitación: estado, fecha límite y valor." />
      <EmptyState title="Todavía no hay bids registrados">
        La tabla ya existe en Supabase con sus reglas de seguridad. El formulario para crear y seguir bids es el siguiente paso.
      </EmptyState>
    </>
  );
}

export function Clients() {
  return (
    <>
      <PageHeader eyebrow="Ventas" title="Clientes" description="Contratistas generales, desarrolladores y administradores de propiedades." />
      <EmptyState title="Todavía no hay clientes registrados">
        La tabla ya existe en Supabase. El alta de clientes llega junto con el formulario de bids.
      </EmptyState>
    </>
  );
}

export function Projects() {
  return (
    <>
      <PageHeader eyebrow="Operaciones" title="Proyectos" description="Obras ganadas: sub asignado, costo, margen, cobros y pagos." />
      <EmptyState title="Segunda fase">
        Se construye cuando bids y subcontratistas estén en uso, para diseñar el seguimiento con datos reales.
      </EmptyState>
    </>
  );
}
