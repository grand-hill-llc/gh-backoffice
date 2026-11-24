// Line icons, 1.5px stroke, as in the design system (never filled).
export function AlertIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5v4.5M8 10.8v1" />
    </svg>
  );
}

export function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M7.5 12.5l3 3 6-6.5" />
    </svg>
  );
}

export function AlertCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 7v6M12 15.8v1" />
    </svg>
  );
}

/** Trash can, for destructive actions. Paired with text, never on its own. */
export function TrashIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2l1-12M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" />
    </svg>
  );
}

/** Arrow out of a box: the link opens another site in a new tab. */
export function ExternalLinkIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-9 9M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </svg>
  );
}
