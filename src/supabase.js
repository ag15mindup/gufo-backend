import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!supabaseUrl || !serviceRoleKey) {
  console.error("ENV MISSING:", { supabaseUrl, serviceRoleKey: !!serviceRoleKey });
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
}

// Debug utile: ti fa capire SUBITO se sta leggendo valori reali
console.log("SUPABASE_URL =", supabaseUrl);
console.log("SERVICE_ROLE_KEY starts with =", serviceRoleKey.slice(0, 10));
console.log("SERVICE_ROLE_KEY length =", serviceRoleKey.length);

export const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});