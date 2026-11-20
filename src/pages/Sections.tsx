import { EmptyState, PageHeader } from "../components/ui";
import { useT } from "../i18n";

export function Projects() {
  const t = useT();
  return (
    <>
      <PageHeader eyebrow={t.sections.operations} title={t.nav.projects} description={t.sections.projectsDescription} />
      <EmptyState title={t.sections.projectsEmptyTitle}>{t.sections.projectsEmptyBody}</EmptyState>
    </>
  );
}
