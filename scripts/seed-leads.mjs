import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const REQUIRED_FLAG = "--confirm-lead-seed";
const CHUNK_SIZE = 200;
const LEAD_COUNT = 10_000;

if (!process.argv.includes(REQUIRED_FLAG)) {
  throw new Error(`Refusing to seed without ${REQUIRED_FLAG}.`);
}

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function demoId(label) {
  const hex = createHash("sha256").update(`khana-banao-demo:${label}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(
    17,
    20,
  )}-${hex.slice(20, 32)}`;
}

function isoDays(offset, hour = 10, minute = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
}

function isoDate(offset) {
  return isoDays(offset).slice(0, 10);
}

function phoneFor(seed) {
  return `+91${8100000000 + seed}`;
}

async function loadContext() {
  const { data: organizations, error: organizationError } = await supabase
    .from("organizations")
    .select("id,slug")
    .eq("is_active", true)
    .limit(2);

  if (organizationError || organizations?.length !== 1) {
    throw new Error("Lead seed requires exactly one active organization.");
  }

  const organization = organizations[0];
  if (!organization || organization.slug !== "khana-banao") {
    throw new Error("Refusing to seed an organization other than khana-banao.");
  }

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id,role")
    .eq("organization_id", organization.id)
    .eq("account_status", "active")
    .is("deleted_at", null);

  if (profileError) {
    throw new Error(`Could not load profiles: ${profileError.message}`);
  }

  const director = profiles.find((profile) => profile.role === "director");
  if (!director) {
    throw new Error("Create the Director before seeding leads.");
  }

  return {
    directorId: director.id,
    organizationId: organization.id,
    sales: profiles.filter((profile) => profile.role === "sales"),
  };
}

async function seedLeads() {
  const { directorId, organizationId, sales } = await loadContext();
  const statuses = [
    "new",
    "contacted",
    "follow_up",
    "qualified",
    "booking_payment_pending",
    "booking_in_process",
    "won",
    "lost",
    "unreachable",
  ];
  const sources = ["Superfone", "Instagram", "Google Ads", "Referral", "Website", "Walk-in"];
  const names = [
    "Aarav Sharma",
    "Aditi Rao",
    "Arjun Mehta",
    "Diya Patel",
    "Ishaan Verma",
    "Kavya Nair",
    "Meera Iyer",
    "Neha Singh",
    "Rohan Gupta",
    "Saanvi Kapoor",
  ];

  const rows = Array.from({ length: LEAD_COUNT }, (_, index) => {
    const providerLead = index % 3 !== 0;
    const salesOwner = sales.length > 0 && index % 5 !== 0 ? sales[index % sales.length].id : null;

    return {
      id: demoId(`lead-${index}`),
      organization_id: organizationId,
      provider: providerLead ? "superfone" : "manual",
      provider_lead_id: providerLead ? `SF-DEMO-${String(index + 1).padStart(5, "0")}` : null,
      source: sources[index % sources.length],
      campaign_name: index % 4 === 0 ? "Wedding Season 2026" : null,
      client_name: `${names[index % names.length]} ${index + 1}`,
      phone_e164: phoneFor(index),
      phone_normalized: phoneFor(index),
      requirement: `${80 + (index % 420)} guests · ${index % 2 ? "North Indian" : "South Indian"} menu`,
      event_date: isoDate((index % 180) - 60),
      guest_count: 80 + (index % 420),
      quote_amount: 25000 + (index % 80) * 1250,
      status: statuses[index % statuses.length],
      assigned_sales_profile_id: salesOwner,
      next_follow_up_at: salesOwner ? isoDays((index % 21) - 7, 6 + (index % 10)) : null,
      notes: index % 7 === 0 ? "Customer prefers a weekend tasting session." : null,
      first_received_at: isoDays(-(index % 120), 4 + (index % 12)),
      last_activity_at: isoDays(-(index % 30), 5 + (index % 12)),
      version: 1,
      created_by_profile_id: providerLead ? null : directorId,
      created_at: isoDays(-(index % 120), 4),
      updated_at: isoDays(-(index % 30), 5),
      deleted_at: null,
    };
  });

  for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
    const chunk = rows.slice(index, index + CHUNK_SIZE);
    const { error } = await supabase.from("leads").upsert(chunk, { onConflict: "id" });
    if (error) {
      throw new Error(`Lead seed failed at row ${index + 1}: ${error.message}`);
    }
    process.stdout.write(`leads: ${Math.min(index + chunk.length, rows.length)}/${rows.length}\n`);
  }

  const { count, error: countError } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  if (countError) {
    throw new Error(`Could not verify lead count: ${countError.message}`);
  }
  process.stdout.write(`active organization leads: ${count ?? 0}\n`);
}

await seedLeads();
