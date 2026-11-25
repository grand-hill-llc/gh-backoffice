import { useEffect, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Lang } from "../lib/prefs";
import ProposalSheet, { type ProposalContent } from "../components/ProposalSheet";
import { AlertCircleIcon, CheckCircleIcon } from "./Icons";
import { dictFor } from "../i18n";

type Status = "sent" | "accepted" | "rejected" | "withdrawn";
type Proposal = {
  lang: Lang;
  content: ProposalContent;
  valid_until: string;
  status: Status;
  expired: boolean;
  decided_at: string | null;
  signer_name: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function dateOf(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
}

/** The page a client opens from the link: read the proposal and accept or reject it. No account needed. */
export default function PublicProposal() {
  const { token } = useParams();
  // Staff open it with ?vista=1 from the bid, so their own visits don't count as the client's.
  const preview = useSearchParams()[0].get("vista") === "1";
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "failed">("loading");

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase.rpc("public_proposal", { p_token: token ?? "", p_preview: preview });
      if (!active) return;
      if (error) return setState("failed");
      if (!data) return setState("missing");
      setProposal(data as Proposal);
      setState("ready");
    })();
    return () => {
      active = false;
    };
  }, [token, preview]);

  useEffect(() => {
    if (proposal) document.title = `${dictFor(proposal.lang).proposal.title} · ${proposal.content.project.title} · Grand Hill`;
  }, [proposal]);

  // Before the proposal loads there is no language: follow the browser.
  const fallback: Lang = typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";

  if (state === "loading") return <p className="gh-muted proposal-status" role="status">{dictFor(fallback).common.loading}</p>;
  if (state !== "ready" || !proposal || proposal.status === "withdrawn") {
    const p = dictFor(proposal?.lang ?? fallback).proposal.public;
    return (
      <div className="proposal-page">
        <div className="proposal-toolbar">
          <img className="proposal-logo" src="/brand/logo-on-light.svg" alt="Grand Hill" width={189} height={40} />
          <div className="gh-notice is-error" role="alert">
            <AlertCircleIcon />
            <p>{state === "failed" ? p.loadFailed : proposal?.status === "withdrawn" ? p.withdrawn : p.notFound}</p>
          </div>
        </div>
      </div>
    );
  }

  const lang = proposal.lang;
  const d = dictFor(lang);
  const p = d.proposal.public;

  const decided = (status: "accepted" | "rejected", at: string, name: string | null) =>
    setProposal({ ...proposal, status, decided_at: at, signer_name: name });

  let acceptance;
  if (proposal.status === "accepted" && proposal.decided_at) {
    acceptance = (
      <div className="gh-notice is-success" role="status">
        <CheckCircleIcon />
        <p>{p.acceptedBy(proposal.signer_name ?? "—", dateOf(proposal.decided_at, d.locale))}</p>
      </div>
    );
  } else if (proposal.status === "rejected" && proposal.decided_at) {
    acceptance = (
      <div className="gh-notice" role="status">
        <AlertCircleIcon />
        <p>{p.rejectedOn(dateOf(proposal.decided_at, d.locale))}</p>
      </div>
    );
  } else if (proposal.expired) {
    acceptance = (
      <div className="gh-notice is-error" role="status">
        <AlertCircleIcon />
        <p>{p.expired}</p>
      </div>
    );
  } else {
    acceptance = <DecisionForm token={token!} lang={lang} onDecided={decided} />;
  }

  return (
    <div className="proposal-page">
      <div className="proposal-toolbar no-print-gap">
        <p className="gh-small gh-muted">{p.intro}</p>
        <div className="proposal-actions">
          <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={() => window.print()}>
            {p.print}
          </button>
        </div>
      </div>
      <ProposalSheet content={proposal.content} lang={lang} acceptance={acceptance} />
    </div>
  );
}

function DecisionForm({
  token,
  lang,
  onDecided,
}: {
  token: string;
  lang: Lang;
  onDecided: (status: "accepted" | "rejected", at: string, name: string | null) => void;
}) {
  const d = dictFor(lang);
  const p = d.proposal.public;
  const [mode, setMode] = useState<"accept" | "reject">("accept");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [agree, setAgree] = useState(false);
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailOk = !email.trim() || EMAIL_RE.test(email.trim());
  const nameError = touched && mode === "accept" && name.trim().length < 2 ? p.nameRequired : null;
  const emailError = touched && !emailOk ? p.invalidEmail : null;
  const agreeError = touched && mode === "accept" && !agree ? p.agreeRequired : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!emailOk || (mode === "accept" && (name.trim().length < 2 || !agree))) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("public_proposal_decide", {
      p_token: token,
      p_accept: mode === "accept",
      p_name: name.trim() || null,
      p_email: email.trim() || null,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) {
      const m = error.message;
      setError(/expired/.test(m) ? p.expired : /not_open/.test(m) ? p.notOpen : /invalid_email/.test(m) ? p.invalidEmail : /name_required/.test(m) ? p.nameRequired : p.failed);
      return;
    }
    const r = data as { status: "accepted" | "rejected"; decided_at: string; signer_name: string | null };
    onDecided(r.status, r.decided_at, r.signer_name);
  };

  return (
    <form className="proposal-decide" onSubmit={submit} noValidate>
      <p>{mode === "accept" ? p.acceptIntro : p.rejectIntro}</p>
      <div className="proposal-decide-grid">
        <div className={`gh-field${nameError ? " is-error" : ""}`}>
          <label className="gh-field-label" htmlFor="decide-name">{mode === "accept" ? p.name : p.nameOptional}</label>
          <input id="decide-name" className="gh-input" autoComplete="name" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!nameError} />
          {nameError && <p className="gh-error">{nameError}</p>}
        </div>
        <div className={`gh-field${emailError ? " is-error" : ""}`}>
          <label className="gh-field-label" htmlFor="decide-email">{p.email}</label>
          <input id="decide-email" className="gh-input" type="email" autoComplete="email" maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!emailError} />
          {emailError && <p className="gh-error">{emailError}</p>}
        </div>
        {mode === "reject" && (
          <div className="gh-field span-2">
            <label className="gh-field-label" htmlFor="decide-note">{p.note}</label>
            <textarea id="decide-note" className="gh-input" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
      </div>
      {mode === "accept" && (
        <div className={`gh-field${agreeError ? " is-error" : ""}`}>
          <label className="gh-check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} aria-invalid={!!agreeError} />
            <span>{p.agree}</span>
          </label>
          {agreeError && <p className="gh-error">{agreeError}</p>}
        </div>
      )}
      {error && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{error}</p>
        </div>
      )}
      <div className="form-actions">
        <button className="gh-btn gh-btn-primary" type="submit" disabled={busy}>
          {busy ? p.sending : mode === "accept" ? p.accept : p.confirmReject}
        </button>
        <button
          className="gh-link"
          type="button"
          disabled={busy}
          onClick={() => {
            setMode(mode === "accept" ? "reject" : "accept");
            setTouched(false);
            setError(null);
          }}
        >
          {mode === "accept" ? p.reject : p.backToAccept}
        </button>
      </div>
    </form>
  );
}
