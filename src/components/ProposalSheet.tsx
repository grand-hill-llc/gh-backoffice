import type { ReactNode } from "react";
import { formatMoney } from "../lib/sales";
import type { Lang } from "../lib/prefs";
import { dictFor } from "../i18n";

/**
 * Everything the client sees in a proposal, and nothing else (never costs or markup).
 * Built from live data for the staff preview, and frozen as JSON in proposal_links when sent.
 */
export type ProposalContent = {
  version: 1;
  reference: string;
  /** YYYY-MM-DD */
  date: string;
  valid_until: string;
  company: { address: string | null; phone: string | null; email: string | null; license: string | null };
  client: { name: string | null; contact: string[] };
  project: { title: string; location: string | null };
  scope: string | null;
  /** null = only the total is shown. */
  lines: { description: string; quantity: number; unit: string | null; amount: number }[] | null;
  total: number | null;
  terms: string | null;
};

function longDate(iso: string, locale: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Paragraphs from text with line breaks. */
function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p, i) => (
          <p key={i}>{p}</p>
        ))}
    </>
  );
}

/** Paper-like proposal (always light). `acceptance` replaces the printed signature block. */
export default function ProposalSheet({ content: c, lang, acceptance }: { content: ProposalContent; lang: Lang; acceptance?: ReactNode }) {
  const d = dictFor(lang);
  const t = d.proposal;
  const money = (v: number) => formatMoney(v, d.locale);
  const company = [c.company.address, c.company.phone, c.company.email].filter(Boolean) as string[];

  return (
    <article className="proposal-sheet" lang={lang}>
      <header className="proposal-head">
        <div>
          <img className="proposal-logo" src="/brand/logo-on-light.svg" alt="Grand Hill" width={189} height={40} />
          {company.length > 0 && <p className="proposal-company">{company.join(" · ")}</p>}
          {c.company.license && <p className="proposal-company">{t.license(c.company.license)}</p>}
        </div>
        <div className="proposal-meta">
          <p className="proposal-kicker">{t.title}</p>
          <dl>
            <div><dt>{t.reference}</dt><dd>{c.reference}</dd></div>
            <div><dt>{t.date}</dt><dd>{longDate(c.date, d.locale)}</dd></div>
            <div><dt>{t.validUntil}</dt><dd>{longDate(c.valid_until, d.locale)}</dd></div>
          </dl>
        </div>
      </header>

      <section className="proposal-parties">
        <div>
          <p className="proposal-label">{t.preparedFor}</p>
          <p className="proposal-strong">{c.client.name ?? "—"}</p>
          {c.client.contact.map((x) => (
            <p key={x}>{x}</p>
          ))}
        </div>
        <div>
          <p className="proposal-label">{t.project}</p>
          <p className="proposal-strong">{c.project.title}</p>
          {c.project.location && <p>{c.project.location}</p>}
        </div>
      </section>

      {c.scope && (
        <section className="proposal-section">
          <h2>{t.scope}</h2>
          <Paragraphs text={c.scope} />
        </section>
      )}

      <section className="proposal-section">
        {c.lines && <h2>{t.items}</h2>}
        <table className="proposal-table">
          {c.lines && (
            <thead>
              <tr>
                <th scope="col">{t.item}</th>
                <th scope="col" className="num">{t.amount}</th>
              </tr>
            </thead>
          )}
          {c.lines && (
            <tbody>
              {c.lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    {l.description}
                    {Number(l.quantity) !== 1 && (
                      <span className="proposal-qty">
                        {Number(l.quantity).toLocaleString(d.locale)} {l.unit ?? ""}
                      </span>
                    )}
                  </td>
                  <td className="num">{money(Number(l.amount))}</td>
                </tr>
              ))}
            </tbody>
          )}
          <tfoot>
            <tr>
              <th scope="row">{t.total}</th>
              <td className="num">{c.total === null ? "—" : money(Number(c.total))}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      {c.terms && (
        <section className="proposal-section proposal-terms">
          <h2>{t.terms}</h2>
          <Paragraphs text={c.terms} />
        </section>
      )}

      <section className="proposal-section proposal-sign">
        <h2>{t.acceptance}</h2>
        {acceptance ?? (
          <>
            <p>{t.acceptanceText}</p>
            <div className="proposal-sign-lines">
              <div><span />{t.signature}</div>
              <div><span />{t.name}</div>
              <div><span />{t.signDate}</div>
            </div>
          </>
        )}
      </section>
    </article>
  );
}
