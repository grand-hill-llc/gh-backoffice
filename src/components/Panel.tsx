import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useT } from "../i18n";

/** White card used on detail pages: a header (title + optional action) over a hairline, then the content. */
export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2 className="panel-title gh-label">{title}</h2>
        {action}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export type FactItem = { label: string; value: string | null | undefined; href?: string };

/** Label / value rows. Empty values are left out instead of showing a column of dashes;
 *  when some are missing and `completeHref` is given, a link invites to fill them in. */
export function Facts({ items, completeHref }: { items: FactItem[]; completeHref?: string }) {
  const t = useT();
  const shown = items.filter((i) => i.value && i.value.trim());
  const missing = items.length - shown.length;

  return (
    <>
      {shown.length > 0 && (
        <dl className="facts">
          {shown.map((i) => (
            <div className="fact" key={i.label}>
              <dt className="gh-label">{i.label}</dt>
              <dd>{i.href ? <a href={i.href}>{i.value}</a> : i.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {missing > 0 && completeHref && (
        <p className="facts-missing">
          <span className="gh-muted">{t.common.missingDetails(items.filter((i) => !i.value || !i.value.trim()).map((i) => i.label.toLowerCase()))}</span>
          <Link className="facts-complete" to={completeHref}>{t.common.completeDetails}</Link>
        </p>
      )}
    </>
  );
}

/** Free-text block (notes, scope) under its own small heading. */
export function NoteBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="note-block">
      <h3 className="gh-label">{title}</h3>
      <p>{text}</p>
    </div>
  );
}

/** "tel:" link target from a phone as typed. */
export const telHref = (phone: string | null) => (phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : undefined);
export const mailHref = (email: string | null) => (email ? `mailto:${email}` : undefined);
