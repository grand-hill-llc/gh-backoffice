/** Text input for a USD amount with a fixed "$" prefix. Parse the value with parseMoney (src/lib/sales.ts). */
export default function MoneyField({
  id,
  label,
  help,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  value: string;
  error: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div className={`gh-field${error ? " is-error" : ""}`}>
      <label className="gh-field-label" htmlFor={id}>{label}</label>
      <div className="money-input">
        <span aria-hidden="true">$</span>
        <input
          id={id}
          className="gh-input"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error || help ? `${id}-help` : undefined}
        />
      </div>
      {error ? <p className="gh-error" id={`${id}-help`}>{error}</p> : help ? <p className="gh-help" id={`${id}-help`}>{help}</p> : null}
    </div>
  );
}
