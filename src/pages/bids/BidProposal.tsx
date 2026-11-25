import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { ESTIMATE_LINE_COLUMNS, estimateTotals, type EstimateLine } from "../../lib/estimates";
import { formatMoney } from "../../lib/sales";
import { todayISO } from "../../lib/subcontractors";
import { usePrefs, type Lang } from "../../lib/prefs";
import { AlertCircleIcon } from "../Icons";
import { dictFor, useT } from "../../i18n";

type BidRow = {
  id: string;
  title: string;
  location: string | null;
  scope: string | null;
  our_price: number | null;
  client: { name: string; contact_name: string | null; email: string | null; phone: string | null } | null;
};

type ProposalSettings = {
  proposal_show_lines: boolean;
  proposal_validity_days: number;
  proposal_terms: string | null;
  company_address: string | null;
  company_phone: string | null;
  company_email: string | null;
  company_license: string | null;
};

const SETTINGS_COLUMNS =
  "proposal_show_lines, proposal_validity_days, proposal_terms, company_address, company_phone, company_email, company_license";

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

function longDate(iso: string, locale: string): string {
  const [y, m, d] = iso.split("-").map(Number);
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

/**
 * Printable client proposal for a bid. Staff only (it reads internal tables), but it shows only
 * what the client may see: descriptions and selling prices, never cost or markup.
 * Always light, like paper, whatever the app theme.
 */
export default function BidProposal() {
  const { id } = useParams();
  const ui = useT();
  const { lang: appLang } = usePrefs();
  const [lang, setLang] = useState<Lang>(appLang);
  const [bid, setBid] = useState<BidRow | null>(null);
  const [lines, setLines] = useState<EstimateLine[]>([]);
  const [settings, setSettings] = useState<ProposalSettings | null>(null);
  const [showLines, setShowLines] = useState(true);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "failed">("loading");

  useEffect(() => {
    let active = true;
    (async () => {
      const [b, l, s] = await Promise.all([
        supabase.from("bids").select("id, title, location, scope, our_price, client:clients(name, contact_name, email, phone)").eq("id", id!).maybeSingle(),
        supabase.from("estimate_lines").select(ESTIMATE_LINE_COLUMNS).eq("bid_id", id!).order("position").order("created_at"),
        supabase.from("app_settings").select(SETTINGS_COLUMNS).maybeSingle(),
      ]);
      if (!active) return;
      if (b.error || l.error || s.error) return setState("failed");
      if (!b.data) return setState("missing");
      const cfg = s.data as unknown as ProposalSettings | null;
      setBid(b.data as unknown as BidRow);
      setLines((l.data ?? []) as EstimateLine[]);
      setSettings(cfg);
      setShowLines(cfg?.proposal_show_lines ?? true);
      setState("ready");
    })();
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (bid) document.title = `${dictFor(lang).proposal.title} · ${bid.title}`;
    return () => {
      document.title = "Grand Hill · Back Office";
    };
  }, [bid, lang]);

  if (state === "loading") return <p className="gh-muted proposal-status" role="status">{ui.common.loading}</p>;
  if (state !== "ready" || !bid)
    return (
      <div className="proposal-status">
        <Link className="back-link" to={`/bids/${id}`}>← {ui.proposal.back}</Link>
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{state === "missing" ? ui.proposal.notFound : ui.proposal.loadFailed}</p>
        </div>
      </div>
    );

  const t = dictFor(lang).proposal;
  const locale = dictFor(lang).locale;
  const money = (v: number) => formatMoney(v, locale);
  const today = todayISO();
  const validity = settings?.proposal_validity_days ?? 30;
  const total = lines.length ? estimateTotals(lines).price : bid.our_price !== null ? Number(bid.our_price) : null;
  const company = [settings?.company_address, settings?.company_phone, settings?.company_email].filter(Boolean) as string[];
  const contact = bid.client ? [bid.client.contact_name, bid.client.email, bid.client.phone].filter(Boolean) : [];
  const withLines = showLines && lines.length > 0;

  return (
    <div className="proposal-page">
      <div className="proposal-toolbar">
        <Link className="back-link" to={`/bids/${bid.id}`}>← {ui.proposal.back}</Link>
        <div className="proposal-controls">
          <div className="segmented" role="group" aria-label={ui.proposal.language}>
            {(["en", "es"] as Lang[]).map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
                {ui.prefs.langs[l]}
              </button>
            ))}
          </div>
          {lines.length > 0 && (
            <div className="segmented" role="group" aria-label={ui.proposal.showLines}>
              <button type="button" aria-pressed={showLines} onClick={() => setShowLines(true)}>{ui.proposal.showLinesOn}</button>
              <button type="button" aria-pressed={!showLines} onClick={() => setShowLines(false)}>{ui.proposal.showLinesOff}</button>
            </div>
          )}
          <button className="gh-btn gh-btn-primary gh-btn-sm" type="button" onClick={() => window.print()} disabled={total === null}>
            {ui.proposal.print}
          </button>
        </div>
        {total === null ? (
          <div className="gh-notice is-error" role="alert">
            <AlertCircleIcon />
            <p>{ui.proposal.noPrice}</p>
          </div>
        ) : (
          <p className="gh-small gh-muted">{ui.proposal.printHint}</p>
        )}
      </div>

      <article className="proposal-sheet" lang={lang}>
        <header className="proposal-head">
          <div>
            <img className="proposal-logo" src="/brand/logo-on-light.svg" alt="Grand Hill" width={189} height={40} />
            {company.length > 0 && <p className="proposal-company">{company.join(" · ")}</p>}
            {settings?.company_license && <p className="proposal-company">{t.license(settings.company_license)}</p>}
          </div>
          <div className="proposal-meta">
            <p className="proposal-kicker">{t.title}</p>
            <dl>
              <div><dt>{t.reference}</dt><dd>{bid.id.slice(0, 8).toUpperCase()}</dd></div>
              <div><dt>{t.date}</dt><dd>{longDate(today, locale)}</dd></div>
              <div><dt>{t.validUntil}</dt><dd>{longDate(addDays(today, validity), locale)}</dd></div>
            </dl>
          </div>
        </header>

        <section className="proposal-parties">
          <div>
            <p className="proposal-label">{t.preparedFor}</p>
            <p className="proposal-strong">{bid.client?.name ?? "—"}</p>
            {contact.map((c) => (
              <p key={c}>{c}</p>
            ))}
          </div>
          <div>
            <p className="proposal-label">{t.project}</p>
            <p className="proposal-strong">{bid.title}</p>
            {bid.location && <p>{bid.location}</p>}
          </div>
        </section>

        {bid.scope && (
          <section className="proposal-section">
            <h2>{t.scope}</h2>
            <Paragraphs text={bid.scope} />
          </section>
        )}

        <section className="proposal-section">
          {withLines && <h2>{t.items}</h2>}
          <table className="proposal-table">
            {withLines && (
              <thead>
                <tr>
                  <th scope="col">{t.item}</th>
                  <th scope="col" className="num">{t.amount}</th>
                </tr>
              </thead>
            )}
            {withLines && (
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.description}
                      {Number(l.quantity) !== 1 && (
                        <span className="proposal-qty">
                          {Number(l.quantity).toLocaleString(locale)} {l.unit ?? ""}
                        </span>
                      )}
                    </td>
                    <td className="num">{money(Number(l.price_amount))}</td>
                  </tr>
                ))}
              </tbody>
            )}
            <tfoot>
              <tr>
                <th scope="row">{t.total}</th>
                <td className="num">{total === null ? "—" : money(total)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        {settings?.proposal_terms && (
          <section className="proposal-section proposal-terms">
            <h2>{t.terms}</h2>
            <Paragraphs text={settings.proposal_terms} />
          </section>
        )}

        <section className="proposal-section proposal-sign">
          <h2>{t.acceptance}</h2>
          <p>{t.acceptanceText}</p>
          <div className="proposal-sign-lines">
            <div><span />{t.signature}</div>
            <div><span />{t.name}</div>
            <div><span />{t.signDate}</div>
          </div>
        </section>
      </article>
    </div>
  );
}
