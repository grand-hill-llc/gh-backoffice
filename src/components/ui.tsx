import type { ReactNode } from "react";

/** Eyebrow is optional: pages with a back link above the title omit it, since the link already says where you are. */
export function PageHeader({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) {
  return (
    <header className="page-header">
      {eyebrow && <p className="gh-eyebrow">{eyebrow}</p>}
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

export type TagTone = "neutral" | "success" | "warning" | "danger" | "strong";

/** Small uppercase status label. Tone is always paired with text, never colour alone. */
export function Tag({ tone = "neutral", children }: { tone?: TagTone; children: ReactNode }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

/** Brand logo. "inverse" sits on the always-dark surfaces (sidebar, login brand panel);
 *  "auto" follows the active theme. Images from the Grand Hill website (public/brand). */
export function Logo({ surface = "auto", height = 32, className = "" }: { surface?: "auto" | "inverse"; height?: number; className?: string }) {
  const width = Math.round((height * 340) / 72);
  if (surface === "inverse")
    return <img className={`logo ${className}`} src="/brand/logo-on-dark.svg" alt="Grand Hill" width={width} height={height} />;
  return (
    <span className={`logo logo-auto ${className}`}>
      <img className="logo-light" src="/brand/logo-on-light.svg" alt="Grand Hill" width={width} height={height} />
      <img className="logo-dark" src="/brand/logo-on-dark.svg" alt="" aria-hidden="true" width={width} height={height} />
    </span>
  );
}
