import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  throw new Error(
    "Faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY. Copia .env.example a .env.local o defínelas en Netlify."
  );
}

// Publishable (anon) key only. Data access is protected by Row Level Security in the database.
// Reads must always reflect the latest writes, so the browser HTTP cache is bypassed for every request.
export const supabase = createClient(url, anonKey, {
  global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
});
