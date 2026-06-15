import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

// Constants baked in — no round-trips to vault
const EHOW_URL = "https://ehowgjardagevnrluult.supabase.co"
// 7dee117c = the REAL SKS tenant_id in ehow app_data.staff.
// FIX 2026-06-15: was previously dcb71d03 (mislabeled "SKS") — that is the
// EQ/core tenant, which mis-tagged every synced SKS worker onto the wrong
// tenant shelf, so EQ Field (reading the SKS shelf) showed no staff.
const SKS_TENANT_ID = "7dee117c-98bd-4d39-af8c-2c81d02a1e85"

// eq_role (jvkn.workers.role) -> employment_type (ehow app_data.staff)
const EMPLOYMENT_TYPE: Record<string, string> = {
  apprentice: "Apprentice",
  labour_hire: "Labour Hire",
  manager: "Direct",
  supervisor: "Direct",
  employee: "Direct",
}

// Set via Supabase Dashboard → eq-canonical → Edge Functions → workers-canonical-sync → Secrets
// Required: WORKERS_WEBHOOK_SECRET, EHOW_SERVICE_ROLE_KEY
// Auto-provided by runtime: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (jvkn)
const WEBHOOK_SECRET = Deno.env.get("WORKERS_WEBHOOK_SECRET") ?? ""
const EHOW_KEY = Deno.env.get("EHOW_SERVICE_ROLE_KEY") ?? ""

// Auto-provided by Supabase runtime (jvkn)
const JVKN_URL = Deno.env.get("SUPABASE_URL") ?? ""
const JVKN_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

Deno.serve(async (req: Request) => {
  if (!WEBHOOK_SECRET || !EHOW_KEY) {
    console.error("workers-canonical-sync: missing WORKERS_WEBHOOK_SECRET or EHOW_SERVICE_ROLE_KEY — set via Supabase Edge Function secrets")
    return new Response("Service not configured", { status: 503 })
  }

  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  let body: { type: string; record?: Record<string, unknown>; old_record?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return new Response("Bad request", { status: 400 })
  }

  const { type, record, old_record } = body
  const worker = record ?? old_record
  if (!worker?.id) return new Response("No worker id", { status: 400 })

  const ehow = createClient(EHOW_URL, EHOW_KEY, { db: { schema: "app_data" } })

  if (type === "DELETE") {
    const { error } = await ehow
      .from("staff")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("cards_worker_id", worker.id as string)
    if (error) {
      console.error("Soft-delete failed:", error)
      return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    }
    return new Response("ok")
  }

  if (!record) return new Response("No record", { status: 400 })

  // Compute dob_day / dob_month from date_of_birth
  let dob_day: number | null = null
  let dob_month: number | null = null
  if (record.date_of_birth) {
    const parts = (record.date_of_birth as string).split("-")
    dob_month = parseInt(parts[1], 10)
    dob_day = parseInt(parts[2], 10)
  }

  const staffRow = {
    tenant_id: SKS_TENANT_ID,
    cards_worker_id: record.id,
    first_name: record.first_name,
    last_name: record.last_name,
    preferred_name: record.preferred_name ?? null,
    email: record.email ?? null,
    phone: record.phone ?? null,
    date_of_birth: record.date_of_birth ?? null,
    dob_day,
    dob_month,
    address_street: record.address_street ?? null,
    address_suburb: record.address_suburb ?? null,
    address_state: record.address_state ?? null,
    address_postcode: record.address_postcode ?? null,
    emergency_contact_name: record.emergency_contact_name ?? null,
    emergency_contact_relationship: record.emergency_contact_relationship ?? null,
    emergency_contact_mobile: record.emergency_contact_phone ?? null,
    employment_type: EMPLOYMENT_TYPE[(record.role as string) ?? ""] ?? "Direct",
    // FIX 2026-06-15: auto-approve pipeline-loaded staff so EQ Field's
    // field_people view (field_approved IS TRUE OR NULL) shows them.
    field_approved: true,
    active: true,
    updated_at: new Date().toISOString(),
    user_id: record.user_id ?? null,
  }

  const { data, error } = await ehow
    .from("staff")
    .upsert(staffRow, { onConflict: "cards_worker_id" })
    .select("staff_id")
    .single()

  if (error) {
    console.error("Upsert to ehow.app_data.staff failed:", error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  // Back-fill jvkn.workers.staff_id on INSERT or UPDATE (if not already set)
  if (data?.staff_id && !record.staff_id) {
    const jvkn = createClient(JVKN_URL, JVKN_KEY)
    const { error: e } = await jvkn
      .from("workers")
      .update({ staff_id: data.staff_id })
      .eq("id", record.id as string)
    if (e) console.error("Back-fill staff_id failed (non-fatal):", e)
  }

  return new Response(JSON.stringify({ staff_id: data?.staff_id }), {
    headers: { "Content-Type": "application/json" },
  })
})
