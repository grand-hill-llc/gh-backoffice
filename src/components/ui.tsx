import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <header className="page-header">
      <p className="gh-eyebrow">{eyebrow}</p>
      <h1 className="gh-h2">{title}</h1>
      {description && <p className="gh-body-lg gh-muted">{description}</p>}
    </header>
  );
}

/** Honest placeholder: says what exists and what comes next. */
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="empty-state">
      <h2 className="gh-h4">{title}</h2>
      <p className="gh-muted">{children}</p>
    </section>
  );
}
