// Supabase Edge Function: staffly-passkey
// Deploy with JWT verification ON (default). The app calls it with the
// public anon key via sbClient.functions.invoke('staffly-passkey', ...).
import * as swa from "npm:@simplewebauthn/server@13.3.3";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHandler } from "./handler.js";

// Your app's address. Change these if the Staffly URL changes.
const RP_ID = Deno.env.get("STAFFLY_RP_ID") ?? "toliflow.vercel.app";
const ORIGINS = (Deno.env.get("STAFFLY_ORIGINS") ?? "https://toliflow.vercel.app")
  .split(",").map((s) => s.trim()).filter(Boolean);

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const rpc = async (fn: string, args: Record<string, unknown>) => {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};

const handle = createHandler({ swa, rpc, rpID: RP_ID, rpName: "Staffly", origins: ORIGINS });

function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const headers = { ...cors(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return new Response(JSON.stringify({ status: "ERROR" }), { status: 405, headers });

  try {
    const body = await req.json();
    const out = await handle(body);
    return new Response(JSON.stringify(out), { status: 200, headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("staffly-passkey:", msg);
    // Short, safe message back to the app.
    const known = msg.match(/SESSION_INVALID|DEVICE_MISMATCH|INVALID_DEVICE|NO_FINGERPRINT|CHALLENGE_INVALID|FINGERPRINT_NOT_REGISTERED|FINGERPRINT_NOT_VERIFIED|CREDENTIAL_MISMATCH|UNKNOWN_ACTION/);
    return new Response(JSON.stringify({ status: "ERROR", code: known ? known[0] : "FAILED" }), { status: 400, headers });
  }
});
