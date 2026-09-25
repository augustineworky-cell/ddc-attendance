// Supabase Edge Function: staffly-push
// Deploy with verify_jwt = FALSE (the database calls it without a login).
// Secrets (Project Settings -> Edge Functions -> Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   from:  npx web-push generate-vapid-keys
//   VAPID_SUBJECT (optional)              e.g. mailto:hr@yourcompany.com
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createPushHandler } from "./handler.js";

const APP_ORIGINS = (Deno.env.get("STAFFLY_ORIGINS") ?? "https://toliflow.vercel.app")
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

const handle = createPushHandler({
  webpush,
  rpc,
  publicKey: Deno.env.get("VAPID_PUBLIC_KEY") ?? "",
  privateKey: Deno.env.get("VAPID_PRIVATE_KEY") ?? "",
  subject: Deno.env.get("VAPID_SUBJECT") ?? "https://toliflow.vercel.app",
});

function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": APP_ORIGINS.includes(o) ? o : APP_ORIGINS[0],
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
    const out = await handle(await req.json());
    return new Response(JSON.stringify(out), { status: 200, headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("staffly-push:", msg);
    const known = msg.match(/NOT_CONFIGURED|BAD_ID|UNKNOWN_ACTION/);
    return new Response(JSON.stringify({ status: "ERROR", code: known ? known[0] : "FAILED" }), { status: 400, headers });
  }
});
