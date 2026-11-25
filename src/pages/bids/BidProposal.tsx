import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { ESTIMATE_LINE_COLUMNS, estimateTotals, type EstimateLine } from "../../lib/estimates";
import { todayISO } from "../../lib/subcontractors";
import { usePrefs, type Lang } from "../../lib/prefs";
import ProposalSheet, { type ProposalContent } from "../../components/ProposalSheet";
import { AlertCircleIcon, CheckCircleIcon } from "../Icons";
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
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export const proposalUrl = (token: string) => `${window.location.origin}/p/${token}`;

/**
 * Client proposal for a bid: preview to print or save as PDF, and the place to create the
 * online link for the client. Staff only. Shows only what the client may see.
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
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState<{ url: string; error?: undefined } | { url?: undefined; error: string } | null>(null);
  const [copied, setCopied] = useState(false);

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

  // A different language or layout is a different proposal: the link shown no longer matches it.
  useEffect(() => {
    setShared(null);
    setCopied(false);
  }, [lang, showLines]);

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

  const today = todayISO();
  const total = lines.length ? estimateTotals(lines).price : bid.our_price !== null ? Number(bid.our_price) : null;
  const content: ProposalContent = {
    version: 1,
    reference: bid.id.slice(0, 8).toUpperCase(),
    date: today,
    valid_until: addDays(today, settings?.proposal_validity_days ?? 30),
    company: {
      address: settings?.company_address ?? null,
      phone: settings?.company_phone ?? null,
      email: settings?.company_email ?? null,
      license: settings?.company_license ?? null,
    },
    client: {
      name: bid.client?.name ?? null,
      contact: bid.client ? ([bid.client.contact_name, bid.client.email, bid.client.phone].filter(Boolean) as string[]) : [],
    },
    project: { title: bid.title, location: bid.location },
    scope: bid.scope,
    lines:
      showLines && lines.length
        ? lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unit: l.unit, amount: Number(l.price_amount) }))
        : null,
    total,
    terms: settings?.proposal_terms ?? null,
  };

  const createLink = async () => {
    setSharing(true);
    setShared(null);
    setCopied(false);
    const { data, error } = await supabase
      .from("proposal_links")
      .insert({ bid_id: bid.id, lang, content, total, valid_until: content.valid_until })
      .select("token")
      .single();
    setSharing(false);
    if (error || !data) {
      setShared({ error: /schema cache|does not exist|relation/i.test(error?.message ?? "") ? ui.proposal.linkMissingTable : ui.proposal.linkFailed });
      return;
    }
    setShared({ url: proposalUrl((data as { token: string }).token) });
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

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
          <div className="proposal-actions">
            <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={() => window.print()} disabled={total === null}>
              {ui.proposal.print}
            </button>
            <button className="gh-btn gh-btn-primary gh-btn-sm" type="button" onClick={createLink} disabled={total === null || sharing}>
              {sharing ? ui.proposal.creatingLink : ui.proposal.createLink}
            </button>
          </div>
        </div>
        {total === null ? (
          <div className="gh-notice is-error" role="alert">
            <AlertCircleIcon />
            <p>{ui.proposal.noPrice}</p>
          </div>
        ) : shared?.url ? (
          <div className="gh-notice is-success proposal-link-box" role="status">
            <CheckCircleIcon />
            <div>
              <p>{ui.proposal.linkReady}</p>
              <div className="proposal-link-row">
                <input className="gh-input" readOnly value={shared.url} onFocus={(e) => e.target.select()} aria-label={ui.proposal.linkLabel} />
                <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={() => copy(shared.url)}>
                  {copied ? ui.proposal.copied : ui.proposal.copy}
                </button>
              </div>
              <p className="gh-small">{ui.proposal.linkHelp}</p>
            </div>
          </div>
        ) : shared?.error ? (
          <div className="gh-notice is-error" role="alert">
            <AlertCircleIcon />
            <p>{shared.error}</p>
          </div>
        ) : (
          <p className="gh-small gh-muted">{ui.proposal.printHint}</p>
        )}
      </div>

      <ProposalSheet content={content} lang={lang} />
    </div>
  );
}
