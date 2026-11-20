import { EmptyState, PageHeader } from "../components/ui";
import { useT } from "../i18n";

export function Bids() {
  const t = useT();
  return (
    <>
      <PageHeader eyebrow={t.sections.sales} title={t.nav.bids} description={t.sections.bidsDescription} />
      <EmptyState title={t.sections.bidsEmptyTitle}>{t.sections.bidsEmptyBody}</EmptyState>
    </>
  );
}

export function Clients() {
  const t = useT();
  return (
    <>
      <PageHeader eyebrow={t.sections.sales} title={t.nav.clients} description={t.sections.clientsDescription} />
      <EmptyState title={t.sections.clientsEmptyTitle}>{t.sections.clientsEmptyBody}</EmptyState>
    </>
  );
}

export function Projects() {
  const t = useT();
  return (
    <>
      <PageHeader eyebrow={t.sections.operations} title={t.nav.projects} description={t.sections.projectsDescription} />
      <EmptyState title={t.sections.projectsEmptyTitle}>{t.sections.projectsEmptyBody}</EmptyState>
    </>
  );
}
