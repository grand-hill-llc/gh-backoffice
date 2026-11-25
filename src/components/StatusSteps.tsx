import { CheckIcon } from "../pages/Icons";

type Props<S extends string> = {
  id: string;
  label: string;
  /** The normal path, in order. Steps before the current one show as done. */
  steps: S[];
  /** Ways out of the path (lost, declined…), shown apart as small buttons at the right edge. */
  endings?: S[];
  /** The step that means success (won): the whole path turns green when it's current. */
  success?: S;
  value: S;
  labels: Record<S, string>;
  busy?: boolean;
  onChange: (value: S) => void;
  message?: { ok: boolean; text: string } | null;
};

/**
 * Status as a timeline spanning the full width: the first dot lines up with the page's left edge,
 * the endings with its right edge. Each segment between dots fills once its step is done.
 * Every step can be clicked.
 */
export default function StatusSteps<S extends string>({ id, label, steps, endings = [], success, value, labels, busy, onChange, message }: Props<S>) {
  const current = steps.indexOf(value);
  const ended = endings.includes(value);
  const isSuccess = value === success;

  return (
    <section className={`status-timeline${ended ? " is-ended" : ""}${isSuccess ? " is-success" : ""}`} aria-labelledby={id}>
      <span className="visually-hidden" id={id}>{label}</span>
      <div className="track-row">
        <ol className="status-track">
          {steps.map((s, i) => {
            const active = s === value;
            const done = !ended && current > i;
            return (
              <li key={s} className={`track-step${done ? " is-done" : ""}${active ? " is-current" : ""}`}>
                <button type="button" aria-pressed={active} disabled={busy} onClick={() => onChange(s)}>
                  <span className="track-dot" aria-hidden="true">
                    {(done || (active && isSuccess)) && <CheckIcon />}
                  </span>
                  <span className="track-label">{labels[s]}</span>
                </button>
              </li>
            );
          })}
        </ol>
        {endings.length > 0 && (
          <div className="track-endings" role="group" aria-labelledby={id}>
            {endings.map((s) => (
              <button key={s} type="button" className={`track-ending${s === value ? " is-current" : ""}`} aria-pressed={s === value} disabled={busy} onClick={() => onChange(s)}>
                {labels[s]}
              </button>
            ))}
          </div>
        )}
      </div>
      {message && (
        <p className={message.ok ? "gh-ok" : "gh-error"} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}
