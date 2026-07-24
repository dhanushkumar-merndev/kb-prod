import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const REQUIRED_FLAG = "--confirm-demo-seed";
const DEMO_PASSWORD = "Demo@12345";
const CHUNK_SIZE = 200;

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

function phoneFor(seed, base = 8100000000) {
  return `+91${base + seed}`;
}

async function upsertRows(table, rows, onConflict = "id", ignoreDuplicates = false) {
  for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
    const chunk = rows.slice(index, index + CHUNK_SIZE);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict, ignoreDuplicates });
    if (error) {
      throw new Error(`${table} seed failed: ${error.message}`);
    }
  }
  process.stdout.write(`${table}: ${rows.length}\n`);
}

async function loadOrganizationAndLeadership() {
  const { data: organizations, error: organizationError } = await supabase
    .from("organizations")
    .select("id,name,slug")
    .eq("is_active", true)
    .limit(2);

  if (organizationError || organizations?.length !== 1) {
    throw new Error("Demo seed requires exactly one active organization.");
  }

  const organization = organizations[0];
  if (!organization || organization.slug !== "khana-banao") {
    throw new Error("Refusing to seed an organization other than khana-banao.");
  }

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id,role,full_name,phone_e164")
    .eq("organization_id", organization.id)
    .eq("account_status", "active")
    .is("deleted_at", null);

  if (profileError) {
    throw new Error(`Could not load profiles: ${profileError.message}`);
  }

  const director = profiles.find((profile) => profile.role === "director");
  const manager = profiles.find((profile) => profile.role === "manager");
  if (!director || !manager) {
    throw new Error("Create an active Director and Manager before running the demo seed.");
  }

  return { director, manager, organization, profiles };
}

async function ensureDemoProfiles(context) {
  const definitions = [
    { fullName: "Demo HR Priya", phone: phoneFor(101, 9000000000), role: "hr" },
    {
      fullName: "Demo Sales Manager Arjun",
      phone: phoneFor(102, 9000000000),
      role: "sales_manager",
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      fullName: `Demo Sales ${index + 1}`,
      phone: phoneFor(201 + index, 9000000000),
      role: "sales",
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      fullName: `Demo Chef ${index + 1}`,
      phone: phoneFor(301 + index, 9000000000),
      role: "chef",
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      fullName: `Demo Part-time Chef ${index + 1}`,
      phone: phoneFor(401 + index, 9000000000),
      role: "part_time_chef",
    })),
  ];

  const { data: usersPage, error: listError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) {
    throw new Error(`Could not load Auth users: ${listError.message}`);
  }

  const authByEmail = new Map(usersPage.users.map((user) => [user.email?.toLowerCase(), user]));
  const profileByPhone = new Map(context.profiles.map((profile) => [profile.phone_e164, profile]));
  const roleHolder = new Map(context.profiles.map((profile) => [profile.role, profile]));

  for (const definition of definitions) {
    let profile = profileByPhone.get(definition.phone);
    if (profile) {
      roleHolder.set(definition.role, profile);
      continue;
    }

    const email = `${definition.phone.replace(/\D/g, "")}@staff.khanabanao.internal`;
    let authUser = authByEmail.get(email);
    if (!authUser) {
      const { data, error } = await supabase.auth.admin.createUser({
        app_metadata: {
          demo_seed: true,
          intended_role: definition.role,
          organization_id: context.organization.id,
        },
        email,
        email_confirm: true,
        password: DEMO_PASSWORD,
        user_metadata: {
          full_name: definition.fullName,
          phone_e164: definition.phone,
        },
      });
      if (error || !data.user) {
        throw new Error(`Could not create ${definition.role} Auth user: ${error?.message}`);
      }
      authUser = data.user;
      authByEmail.set(email, authUser);
    }

    const reportsTo =
      definition.role === "hr" || definition.role === "sales_manager"
        ? context.manager.id
        : definition.role === "sales"
          ? roleHolder.get("sales_manager")?.id
          : roleHolder.get("hr")?.id;

    if (!reportsTo) {
      throw new Error(`Missing reporting profile for ${definition.role}.`);
    }

    const isChef = definition.role === "chef" || definition.role === "part_time_chef";
    const { error } = await supabase.rpc("create_team_member_profile", {
      p_aadhaar_storage_path: null,
      p_account_status: "active",
      p_actor_profile_id: context.director.id,
      p_auth_user_id: authUser.id,
      p_full_name: definition.fullName,
      p_joining_date: "2026-01-01",
      p_part_time_payment_amount: definition.role === "part_time_chef" ? 1500 : null,
      p_part_time_payment_proof_path:
        definition.role === "part_time_chef"
          ? `${context.organization.id}/${authUser.id}/part-time-payment-proof/demo.pdf`
          : null,
      p_payment_amount: isChef ? (definition.role === "chef" ? 30000 : 1500) : null,
      p_payment_type: isChef ? (definition.role === "chef" ? "monthly" : "per_booking") : null,
      p_phone_e164: definition.phone,
      p_reports_to_profile_id: reportsTo,
      p_request_id: `demo-seed-${definition.role}-${authUser.id}`,
      p_role: definition.role,
    });
    if (error) {
      throw new Error(`Could not create ${definition.role} profile: ${error.message}`);
    }

    profile = {
      id: authUser.id,
      full_name: definition.fullName,
      phone_e164: definition.phone,
      role: definition.role,
    };
    profileByPhone.set(definition.phone, profile);
    roleHolder.set(definition.role, profile);
    context.profiles.push(profile);
  }

  const { data: refreshed, error } = await supabase
    .from("profiles")
    .select("id,role,full_name,phone_e164")
    .eq("organization_id", context.organization.id)
    .eq("account_status", "active")
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return refreshed;
}

async function seedBusinessData(context, profiles) {
  const organizationId = context.organization.id;
  const directorId = context.director.id;
  const managerId = context.manager.id;
  const sales = profiles.filter((profile) => profile.role === "sales");
  const chefs = profiles.filter((profile) => ["chef", "part_time_chef"].includes(profile.role));
  const hr = profiles.find((profile) => profile.role === "hr");
  const salesManager = profiles.find((profile) => profile.role === "sales_manager");
  if (!hr || !salesManager || sales.length < 5 || chefs.length < 6) {
    throw new Error("Demo staff profile creation was incomplete.");
  }

  const leadStatuses = [
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

  const leads = Array.from({ length: 1000 }, (_, index) => {
    const providerLead = index % 3 !== 0;
    const salesOwner = index % 5 === 0 ? null : sales[index % sales.length].id;
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
      status: leadStatuses[index % leadStatuses.length],
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
  await upsertRows("leads", leads);

  const assignedLeads = leads.filter((lead) => lead.assigned_sales_profile_id);
  // The database assignment trigger creates the active history record.
  await upsertRows(
    "lead_activities",
    Array.from({ length: 1500 }, (_, index) => {
      const lead = leads[index % leads.length];
      const owner = lead.assigned_sales_profile_id ?? salesManager.id;
      return {
        id: demoId(`lead-activity-${index}`),
        organization_id: organizationId,
        lead_id: lead.id,
        actor_profile_id: owner,
        activity_type: ["note", "call", "status_change", "message"][index % 4],
        summary: `Demo activity ${index + 1} for ${lead.client_name}`,
        metadata: { demo: true, sequence: index + 1 },
        occurred_at: isoDays(-(index % 60), 5 + (index % 12)),
      };
    }),
  );

  const followUps = assignedLeads.slice(0, 400).map((lead, index) => {
    const status = ["open", "completed", "overdue", "cancelled"][index % 4];
    return {
      id: demoId(`follow-up-${index}`),
      organization_id: organizationId,
      lead_id: lead.id,
      assigned_profile_id: lead.assigned_sales_profile_id,
      due_at: isoDays((index % 30) - 12, 6 + (index % 10)),
      status,
      outcome:
        status === "completed"
          ? "Customer confirmed requirements."
          : status === "cancelled"
            ? "Customer requested no further calls."
            : null,
      completed_at: status === "completed" ? isoDays(-(index % 10), 9) : null,
      created_by_profile_id: salesManager.id,
    };
  });
  await upsertRows("follow_ups", followUps);

  const conversations = assignedLeads.slice(0, 300).map((lead, index) => ({
    id: demoId(`conversation-${index}`),
    organization_id: organizationId,
    lead_id: lead.id,
    provider: "superfone",
    provider_conversation_id: `SF-CONV-DEMO-${index + 1}`,
    channel: index % 2 ? "whatsapp" : "sms",
    contact_name: lead.client_name,
    contact_phone_e164: lead.phone_e164,
    assigned_sales_profile_id: lead.assigned_sales_profile_id,
    status: ["open", "pending", "resolved", "closed"][index % 4],
    last_message_at: isoDays(-(index % 20), 8),
    last_message_preview: "Please share the latest menu and quotation.",
    last_inbound_at: isoDays(-(index % 20), 7),
    last_outbound_at: isoDays(-(index % 20), 8),
    closed_at: index % 4 === 3 ? isoDays(-(index % 15), 10) : null,
    version: 1,
  }));
  await upsertRows("conversations", conversations);

  const messages = Array.from({ length: 900 }, (_, index) => {
    const conversation = conversations[Math.floor(index / 3)];
    const lead = assignedLeads[Math.floor(index / 3)];
    const direction = index % 3 === 0 ? "inbound" : "outbound";
    const timestamp = isoDays(-(index % 25), 6 + (index % 12));
    return {
      id: demoId(`message-${index}`),
      organization_id: organizationId,
      conversation_id: conversation.id,
      lead_id: lead.id,
      provider: "superfone",
      provider_message_id: `SF-MSG-DEMO-${index + 1}`,
      provider_event_id: `SF-MSG-EVENT-DEMO-${index + 1}`,
      direction,
      channel: conversation.channel,
      message_type: "text",
      body:
        direction === "inbound"
          ? "Can you share package details for our event?"
          : "Certainly. I am sharing the menu and quotation.",
      attachment_storage_path: null,
      sender_profile_id: direction === "outbound" ? lead.assigned_sales_profile_id : null,
      recipient_phone_e164: direction === "outbound" ? lead.phone_e164 : null,
      status: direction === "inbound" ? "received" : index % 4 === 0 ? "read" : "delivered",
      provider_created_at: timestamp,
      sent_at: direction === "outbound" ? timestamp : null,
      delivered_at: direction === "outbound" ? timestamp : null,
      read_at: direction === "outbound" && index % 4 === 0 ? timestamp : null,
      failed_at: null,
      failure_code: null,
      failure_message_safe: null,
      reply_to_message_id: null,
      idempotency_key: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
  });
  await upsertRows("messages", messages);

  const calls = assignedLeads.slice(0, 350).map((lead, index) => {
    const startedAt = isoDays(-(index % 45), 5 + (index % 12));
    const duration = index % 5 === 0 ? 0 : 45 + (index % 900);
    return {
      id: demoId(`call-${index}`),
      organization_id: organizationId,
      conversation_id: index < conversations.length ? conversations[index].id : null,
      lead_id: lead.id,
      provider_call_id: `SF-CALL-DEMO-${index + 1}`,
      direction: index % 4 === 0 ? "inbound" : "outbound",
      from_phone_e164: index % 4 === 0 ? lead.phone_e164 : phoneFor(999, 9000000000),
      to_phone_e164: index % 4 === 0 ? phoneFor(999, 9000000000) : lead.phone_e164,
      agent_profile_id: lead.assigned_sales_profile_id,
      status: duration === 0 ? "no_answer" : "completed",
      started_at: startedAt,
      answered_at: duration === 0 ? null : startedAt,
      ended_at: startedAt,
      duration_seconds: duration,
      recording_external_url: null,
    };
  });
  await upsertRows("superfone_calls", calls);

  const bookingServiceStatuses = [
    "confirmed",
    "chef_assigned",
    "preparing",
    "service_completed",
    "fully_completed",
    "cancelled",
  ];
  const bookings = leads.slice(0, 180).map((lead, index) => {
    const serviceStatus = bookingServiceStatuses[index % bookingServiceStatuses.length];
    return {
      id: demoId(`booking-${index}`),
      organization_id: organizationId,
      booking_code: `KB-DEMO-${String(index + 1).padStart(4, "0")}`,
      lead_id: lead.id,
      client_name: lead.client_name,
      phone_e164: lead.phone_e164,
      event_type: ["Wedding", "Birthday", "Corporate", "House Party"][index % 4],
      event_date: isoDate((index % 120) - 45),
      event_start_time: "18:00",
      reporting_time: "12:00",
      venue: `Demo Venue ${1 + (index % 20)}, Bengaluru`,
      guest_count: lead.guest_count,
      menu: index % 2 ? "North Indian buffet with desserts" : "South Indian festive menu",
      instructions: "Demo booking for workflow testing.",
      total_value: 40000 + (index % 30) * 5000,
      payment_status: ["unpaid", "partial", "fully_paid"][index % 3],
      service_status: serviceStatus,
      sold_by_profile_id: lead.assigned_sales_profile_id ?? sales[index % sales.length].id,
      service_completed_at: ["service_completed", "fully_completed"].includes(serviceStatus)
        ? isoDays(-(index % 30), 14)
        : null,
      fully_completed_at: serviceStatus === "fully_completed" ? isoDays(-(index % 25), 16) : null,
      version: 1,
      deleted_at: null,
    };
  });
  await upsertRows("bookings", bookings);
  await upsertRows(
    "booking_status_history",
    bookings.map((booking, index) => ({
      id: demoId(`booking-status-${index}`),
      organization_id: organizationId,
      booking_id: booking.id,
      from_status: "pending",
      to_status: booking.service_status,
      changed_by_profile_id: managerId,
      reason: "Demo workflow progression",
      changed_at: isoDays(-(index % 45), 8),
    })),
  );

  const assignableBookings = bookings.filter((booking) => booking.service_status !== "cancelled");
  await upsertRows(
    "booking_assignments",
    assignableBookings.slice(0, 150).map((booking, index) => ({
      id: demoId(`booking-assignment-${index}`),
      organization_id: organizationId,
      booking_id: booking.id,
      chef_profile_id: chefs[index % chefs.length].id,
      assigned_by_profile_id: hr.id,
      assigned_at: isoDays(-(index % 30), 7),
      unassigned_at: null,
      is_primary: true,
      agreed_pay_type:
        chefs[index % chefs.length].role === "part_time_chef" ? "per_booking" : "daily",
      agreed_pay_amount:
        chefs[index % chefs.length].role === "part_time_chef" ? 1800 + (index % 5) * 200 : 1200,
      instructions: "Report before prep time and update job status.",
    })),
  );

  const payments = bookings.flatMap((booking, index) => {
    const base = {
      organization_id: organizationId,
      booking_id: booking.id,
      payment_method: index % 2 ? "UPI" : "Bank transfer",
      submitted_by_profile_id: booking.sold_by_profile_id,
    };
    const verified = index % 4 !== 0;
    const rows = [
      {
        ...base,
        id: demoId(`payment-advance-${index}`),
        payment_stage: "advance",
        amount: Number(booking.total_value) * 0.4,
        transaction_reference: `DEMO-ADV-${index + 1}`,
        proof_storage_path: `${organizationId}/${booking.sold_by_profile_id}/${booking.id}/advance.jpg`,
        verification_status: verified ? "verified" : "pending",
        verified_by_profile_id: verified ? salesManager.id : null,
        verified_at: verified ? isoDays(-(index % 20), 10) : null,
        rejection_reason: null,
        paid_at: isoDays(-(index % 30), 9),
      },
    ];
    if (index < 60) {
      rows.push({
        ...base,
        id: demoId(`payment-final-${index}`),
        payment_stage: "final",
        amount: Number(booking.total_value) * 0.6,
        transaction_reference: `DEMO-FINAL-${index + 1}`,
        proof_storage_path: `${organizationId}/${booking.sold_by_profile_id}/${booking.id}/final.jpg`,
        verification_status: index % 3 === 0 ? "pending" : "verified",
        verified_by_profile_id: index % 3 === 0 ? null : salesManager.id,
        verified_at: index % 3 === 0 ? null : isoDays(-(index % 10), 12),
        rejection_reason: null,
        paid_at: isoDays(-(index % 15), 11),
      });
    }
    return rows;
  });
  await upsertRows("booking_payments", payments);

  const temporaryWorkers = Array.from({ length: 20 }, (_, index) => ({
    id: demoId(`temporary-worker-${index}`),
    organization_id: organizationId,
    full_name: `Demo Temporary Worker ${index + 1}`,
    phone_e164: phoneFor(501 + index, 9000000000),
    worker_type: ["helper", "server", "cleaner", "driver", "other"][index % 5],
    payment_type: index % 2 ? "daily" : "hourly",
    payment_amount: index % 2 ? 900 : 150,
    notes: "Demo temporary workforce record.",
    is_active: index % 8 !== 0,
    created_by_profile_id: hr.id,
    deleted_at: null,
  }));
  await upsertRows("temporary_workers", temporaryWorkers);
  await upsertRows(
    "temporary_worker_assignments",
    temporaryWorkers.map((worker, index) => ({
      id: demoId(`temporary-assignment-${index}`),
      organization_id: organizationId,
      temporary_worker_id: worker.id,
      booking_id: assignableBookings[index].id,
      work_date: assignableBookings[index].event_date,
      reporting_time: "12:00",
      agreed_payment: 900 + (index % 4) * 100,
      notes: "Demo event support assignment.",
      created_by_profile_id: hr.id,
    })),
  );

  const attendanceSubjects = [...chefs, ...temporaryWorkers];
  const attendance = Array.from({ length: 500 }, (_, index) => {
    const subject = attendanceSubjects[index % attendanceSubjects.length];
    const isProfile = "role" in subject;
    const status = ["approved", "pending_approval", "corrected", "rejected"][index % 4];
    const startedAt = isoDays(-(index % 60), 3);
    return {
      id: demoId(`attendance-${index}`),
      organization_id: organizationId,
      profile_id: isProfile ? subject.id : null,
      temporary_worker_id: isProfile ? null : subject.id,
      booking_id: assignableBookings[index % assignableBookings.length].id,
      shift_date: isoDate(-(index % 60)),
      started_at: startedAt,
      ended_at: isoDays(-(index % 60), 12),
      start_location: { city: "Bengaluru", demo: true },
      end_location: { city: "Bengaluru", demo: true },
      status,
      submitted_at: isoDays(-(index % 60), 12),
      approved_by_profile_id: ["approved", "corrected"].includes(status) ? hr.id : null,
      approved_at: ["approved", "corrected"].includes(status) ? isoDays(-(index % 60), 13) : null,
      corrected_by_profile_id: status === "corrected" ? hr.id : null,
      correction_reason: status === "corrected" ? "Adjusted demo checkout time." : null,
      overtime_minutes: index % 5 === 0 ? 60 : 0,
      payroll_eligible: ["approved", "corrected"].includes(status),
    };
  });
  await upsertRows("attendance_shifts", attendance);

  const expenseSubmitters = [...sales, ...chefs];
  const expenses = Array.from({ length: 200 }, (_, index) => {
    const status = ["pending", "verified", "approved", "rejected", "paid"][index % 5];
    return {
      id: demoId(`expense-${index}`),
      organization_id: organizationId,
      submitted_by_profile_id: expenseSubmitters[index % expenseSubmitters.length].id,
      booking_id: index % 3 === 0 ? null : bookings[index % bookings.length].id,
      category: ["Travel", "Ingredients", "Equipment", "Fuel", "Other"][index % 5],
      amount: 250 + (index % 20) * 175,
      reason: `Demo expense claim ${index + 1}`,
      status,
      reviewed_by_profile_id: status === "pending" ? null : managerId,
      reviewed_at: status === "pending" ? null : isoDays(-(index % 20), 13),
      rejection_reason: status === "rejected" ? "Receipt is not readable." : null,
    };
  });
  await upsertRows("expenses", expenses);

  await upsertRows(
    "leave_requests",
    Array.from({ length: 80 }, (_, index) => {
      const status = ["pending", "approved", "rejected", "cancelled"][index % 4];
      return {
        id: demoId(`leave-${index}`),
        organization_id: organizationId,
        profile_id: expenseSubmitters[index % expenseSubmitters.length].id,
        start_date: isoDate((index % 90) - 20),
        end_date: isoDate((index % 90) - 19),
        reason: `Demo leave request ${index + 1}`,
        status,
        reviewed_by_profile_id: status === "pending" ? null : managerId,
        reviewed_at: status === "pending" ? null : isoDays(-(index % 15), 10),
        review_note: status === "rejected" ? "Operational coverage unavailable." : null,
      };
    }),
  );

  const taskAssignees = profiles.filter((profile) => profile.role !== "director");
  await upsertRows(
    "tasks",
    Array.from({ length: 300 }, (_, index) => {
      const status = ["open", "in_progress", "completed", "cancelled"][index % 4];
      return {
        id: demoId(`task-${index}`),
        organization_id: organizationId,
        title: `Demo operational task ${index + 1}`,
        description: "Generated to test task filters, role queues, and completion states.",
        assigned_to_profile_id: taskAssignees[index % taskAssignees.length].id,
        assigned_by_profile_id: index % 2 ? managerId : directorId,
        booking_id: index % 3 === 0 ? bookings[index % bookings.length].id : null,
        lead_id: index % 3 === 1 ? leads[index % leads.length].id : null,
        due_at: isoDays((index % 40) - 10, 9),
        priority: ["low", "normal", "high", "urgent"][index % 4],
        status,
        completed_at: status === "completed" ? isoDays(-(index % 12), 11) : null,
      };
    }),
  );

  const meetings = Array.from({ length: 30 }, (_, index) => ({
    id: demoId(`meeting-${index}`),
    organization_id: organizationId,
    title: `Demo team meeting ${index + 1}`,
    reason: "Weekly operations and service readiness review.",
    starts_at: isoDays((index % 45) - 15, 6),
    ends_at: isoDays((index % 45) - 15, 7),
    location: index % 2 ? "Khana Banao Office" : "Google Meet",
    meeting_url: index % 2 ? null : "https://meet.google.com/demo-khana-banao",
    status: ["scheduled", "completed", "cancelled"][index % 3],
    created_by_profile_id: index % 2 ? managerId : hr.id,
    deleted_at: null,
  }));
  await upsertRows("meetings", meetings);
  await upsertRows(
    "meeting_attendees",
    meetings.flatMap((meeting, meetingIndex) =>
      taskAssignees.slice(0, 8).map((profile, profileIndex) => ({
        organization_id: organizationId,
        meeting_id: meeting.id,
        profile_id: profile.id,
        attendance_status: ["invited", "accepted", "attended", "declined"][
          (meetingIndex + profileIndex) % 4
        ],
      })),
    ),
    "meeting_id,profile_id",
  );

  const payrollPeriods = [
    {
      id: demoId("payroll-period-paid"),
      organization_id: organizationId,
      period_start: "2026-05-01",
      period_end: "2026-05-31",
      status: "paid",
      prepared_by_profile_id: hr.id,
      reviewed_by_profile_id: managerId,
      approved_by_profile_id: directorId,
      prepared_at: "2026-06-01T04:30:00.000Z",
      reviewed_at: "2026-06-02T04:30:00.000Z",
      approved_at: "2026-06-03T04:30:00.000Z",
      paid_at: "2026-06-05T06:00:00.000Z",
      payment_reference: "DEMO-PAYROLL-MAY-2026",
      locked_at: null,
    },
    {
      id: demoId("payroll-period-current"),
      organization_id: organizationId,
      period_start: "2026-06-01",
      period_end: "2026-06-30",
      status: "prepared",
      prepared_by_profile_id: hr.id,
      reviewed_by_profile_id: null,
      approved_by_profile_id: null,
      prepared_at: "2026-07-01T04:30:00.000Z",
      reviewed_at: null,
      approved_at: null,
      paid_at: null,
      payment_reference: null,
      locked_at: null,
    },
  ];
  await upsertRows("payroll_periods", payrollPeriods, "id", true);
  const payrollSubjects = [...chefs, ...temporaryWorkers.slice(0, 10)];
  const payrollEntries = payrollPeriods.flatMap((period, periodIndex) =>
    payrollSubjects.map((subject, subjectIndex) => {
      const isProfile = "role" in subject;
      const paid = periodIndex === 0;
      const baseAmount = isProfile ? 12000 : 2500;
      const bookingEarnings = 1500 + (subjectIndex % 5) * 300;
      const overtimeAmount = (subjectIndex % 4) * 250;
      const expensesAmount = (subjectIndex % 3) * 400;
      const net = baseAmount + bookingEarnings + overtimeAmount + expensesAmount - 500;
      return {
        id: demoId(`payroll-entry-${periodIndex}-${subjectIndex}`),
        organization_id: organizationId,
        payroll_period_id: period.id,
        profile_id: isProfile ? subject.id : null,
        temporary_worker_id: isProfile ? null : subject.id,
        base_amount: baseAmount,
        attendance_amount: 0,
        booking_earnings: bookingEarnings,
        overtime_amount: overtimeAmount,
        expense_reimbursement: expensesAmount,
        allowances: 0,
        deductions: 500,
        advances: 0,
        net_payable: net,
        status: paid ? "paid" : "draft",
        payment_reference: paid ? `DEMO-PAY-${subjectIndex + 1}` : null,
        paid_at: paid ? period.paid_at : null,
      };
    }),
  );
  await upsertRows("payroll_entries", payrollEntries, "id", true);

  await upsertRows(
    "notifications",
    Array.from({ length: 200 }, (_, index) => {
      const recipient = taskAssignees[index % taskAssignees.length];
      return {
        id: demoId(`notification-${index}`),
        organization_id: organizationId,
        recipient_profile_id: recipient.id,
        notification_type: [
          "lead_assignment",
          "follow_up_due",
          "chef_assignment",
          "attendance_decision",
          "task_assignment",
          "info",
        ][index % 6],
        title: `Demo notification ${index + 1}`,
        body: "Generated notification for realtime and unread-state testing.",
        entity_type: index % 2 ? "lead" : "booking",
        entity_id:
          index % 2 ? leads[index % leads.length].id : bookings[index % bookings.length].id,
        read_at: index % 3 === 0 ? isoDays(-(index % 10), 9) : null,
        created_at: isoDays(-(index % 20), 8),
      };
    }),
  );

  await upsertRows("integration_connections", [
    {
      id: demoId("integration-superfone"),
      organization_id: organizationId,
      provider: "superfone",
      status: "disconnected",
      account_identifier_safe: "demo-account",
      capabilities: {
        demo: true,
        fetchLeads: false,
        verifyWebhook: false,
      },
      connected_by_profile_id: null,
      connected_at: null,
      last_tested_at: isoDays(-1, 8),
      last_success_at: null,
      last_error_safe: "Demo record: official provider adapter is not enabled.",
    },
  ]);
  await upsertRows(
    "integration_events",
    Array.from({ length: 50 }, (_, index) => ({
      id: demoId(`integration-event-${index}`),
      organization_id: organizationId,
      provider: "superfone",
      provider_event_id: `DEMO-EVENT-${index + 1}`,
      event_type: index % 2 ? "CUSTOMER_CHANGE" : "CUSTOMER_CREATE",
      payload: { demo: true, sequence: index + 1 },
      status: index % 6 === 0 ? "failed" : "processed",
      attempt_count: 1,
      received_at: isoDays(-(index % 20), 7),
      processed_at: isoDays(-(index % 20), 7),
      last_error_safe: index % 6 === 0 ? "Demo mapping failure" : null,
    })),
  );
  await upsertRows(
    "integration_sync_runs",
    Array.from({ length: 12 }, (_, index) => ({
      id: demoId(`integration-sync-${index}`),
      organization_id: organizationId,
      provider: "superfone",
      sync_type: index ? "incremental" : "historical",
      status: index % 5 === 0 ? "partially_completed" : "completed",
      cursor_before: index ? `demo-${index * 100}` : null,
      cursor_after: `demo-${(index + 1) * 100}`,
      fetched_count: 100,
      inserted_count: index ? 10 : 90,
      updated_count: index ? 80 : 0,
      duplicate_count: 10,
      failed_count: index % 5 === 0 ? 2 : 0,
      started_by_profile_id: directorId,
      started_at: isoDays(-(index + 1), 5),
      completed_at: isoDays(-(index + 1), 6),
      error_summary_safe: index % 5 === 0 ? "Two demo rows could not be mapped." : null,
    })),
  );
}

const context = await loadOrganizationAndLeadership();
const profiles = await ensureDemoProfiles(context);
await seedBusinessData(context, profiles);

process.stdout.write("\nDemo seed complete.\n");
process.stdout.write(`Demo staff password: ${DEMO_PASSWORD}\n`);
process.stdout.write("Demo phones: +919000000101 through +919000000402 (defined role ranges).\n");
