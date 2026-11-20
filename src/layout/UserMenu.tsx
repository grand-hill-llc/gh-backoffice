import { useEffect, useId, useRef, useState } from "react";
import { PrefsControls } from "../components/PrefsControls";
import { useT } from "../i18n";

/** Sidebar footer: the signed-in person as a button that opens a small panel with theme, language and sign out. */
export default function UserMenu({ name, role, onSignOut }: { name: string; role: string; onSignOut: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={rootRef}>
      {open && (
        <div className="user-menu-panel" id={panelId} role="group" aria-label={t.prefs.accountMenu}>
          <PrefsControls idPrefix={`${panelId}-prefs`} />
          <button className="gh-btn gh-btn-secondary gh-btn-sm gh-btn-block" type="button" onClick={onSignOut}>
            {t.common.signOut}
          </button>
        </div>
      )}
      <button
        ref={buttonRef}
        className="user-menu-trigger"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${name} · ${t.prefs.accountMenu}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="user-menu-who">
          <span className="sidebar-user-name">{name}</span>
          <span className="gh-label">{role}</span>
        </span>
        <svg className="user-menu-chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 10l4-4 4 4" />
        </svg>
      </button>
    </div>
  );
}
