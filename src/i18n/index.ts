import { usePrefs, type Lang } from "../lib/prefs";
import { tradeKeyOf } from "../lib/subcontractors";
import en from "./en";
import es, { type Dict } from "./es";

const DICTS: Record<Lang, Dict> = { es, en };
const TRADE_LABEL_SETS = [es.subs.trades, en.subs.trades];

/** Current-language dictionary: `const t = useT(); t.subs.title`. */
export function useT(): Dict {
  return DICTS[usePrefs().lang];
}

/** Display label for a stored trade: suggested trades follow the language, custom ones show as typed. */
export function tradeLabel(value: string, t: Dict): string {
  const key = tradeKeyOf(value, TRADE_LABEL_SETS);
  return key ? t.subs.trades[key] : value;
}

/** Value to store for a trade: the key for suggested trades (also fixes legacy Spanish labels), else the trimmed text. */
export function normalizeTrade(value: string): string {
  return tradeKeyOf(value, TRADE_LABEL_SETS) ?? value.trim();
}

export type { Dict };
