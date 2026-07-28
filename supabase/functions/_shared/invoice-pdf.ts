import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { AppError, fromDatabaseError } from "./errors.ts";
import { formatInrAmount, wrapInvoiceText } from "./invoice-format.ts";

interface InvoiceSnapshot {
  booking_id: string;
  client_name: string;
  currency: string;
  created_at: string;
  customer_email: string | null;
  customer_phone_e164: string;
  event_date: string;
  event_type: string;
  guest_count: number;
  id: string;
  invoice_number: string;
  payment_instructions: string | null;
  pdf_storage_path: string | null;
  service_description: string;
  status: "generation_failed" | "issued" | "pending_generation" | "void";
  subtotal: number;
  terms: string;
  total: number;
  venue: string;
}

interface OrganizationSnapshot {
  currency: string;
  name: string;
}

export interface GeneratedInvoice {
  bytes: Uint8Array;
  fileName: string;
  invoiceId: string;
  invoiceNumber: string;
  storagePath: string;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new AppError("DATABASE_OPERATION_FAILED");
  }

  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AppError("DATABASE_OPERATION_FAILED", {
      details: { reason: `Invalid ${field}.` },
    });
  }
  return value;
}

function numberValue(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AppError("DATABASE_OPERATION_FAILED", {
      details: { reason: `Invalid ${field}.` },
    });
  }
  return parsed;
}

function parseInvoice(value: unknown): InvoiceSnapshot {
  const row = record(value);
  const status = stringValue(row.status, "status");
  if (!["pending_generation", "issued", "generation_failed", "void"].includes(status)) {
    throw new AppError("DATABASE_OPERATION_FAILED");
  }

  return {
    booking_id: stringValue(row.booking_id, "booking_id"),
    client_name: stringValue(row.client_name, "client_name"),
    currency: stringValue(row.currency, "currency"),
    created_at: stringValue(row.created_at, "created_at"),
    customer_email: typeof row.customer_email === "string" ? row.customer_email : null,
    customer_phone_e164: stringValue(row.customer_phone_e164, "customer_phone_e164"),
    event_date: stringValue(row.event_date, "event_date"),
    event_type: stringValue(row.event_type, "event_type"),
    guest_count: numberValue(row.guest_count, "guest_count"),
    id: stringValue(row.id, "id"),
    invoice_number: stringValue(row.invoice_number, "invoice_number"),
    payment_instructions:
      typeof row.payment_instructions === "string" ? row.payment_instructions : null,
    pdf_storage_path: typeof row.pdf_storage_path === "string" ? row.pdf_storage_path : null,
    service_description: stringValue(row.service_description, "service_description"),
    status: status as InvoiceSnapshot["status"],
    subtotal: numberValue(row.subtotal, "subtotal"),
    terms: stringValue(row.terms, "terms"),
    total: numberValue(row.total, "total"),
    venue: stringValue(row.venue, "venue"),
  };
}

function parseOrganization(value: unknown): OrganizationSnapshot {
  const row = record(value);
  return {
    currency: stringValue(row.currency, "currency"),
    name: stringValue(row.name, "name"),
  };
}

function bytesToData(bytes: ArrayBuffer): Uint8Array {
  return new Uint8Array(bytes);
}

async function existingInvoice(
  admin: SupabaseClient,
  invoice: InvoiceSnapshot,
): Promise<GeneratedInvoice | null> {
  if (invoice.status !== "issued" || !invoice.pdf_storage_path) {
    return null;
  }

  const download = await admin.storage.from("invoices").download(invoice.pdf_storage_path);
  if (download.error) throw fromDatabaseError(download.error);

  return {
    bytes: bytesToData(await download.data.arrayBuffer()),
    fileName: `${invoice.invoice_number}.pdf`,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
    storagePath: invoice.pdf_storage_path,
  };
}

interface DrawState {
  bold: PDFFont;
  document: PDFDocument;
  page: PDFPage;
  regular: PDFFont;
  y: number;
}

function ensureRoom(state: DrawState, requiredHeight: number): void {
  if (state.y - requiredHeight >= 58) {
    return;
  }

  state.page = state.document.addPage([595.28, 841.89]);
  state.y = 790;
  state.page.drawText("Khana Banao · Invoice continued", {
    color: rgb(0.043, 0.145, 0.271),
    font: state.bold,
    size: 11,
    x: 48,
    y: 810,
  });
}

function drawWrapped(
  state: DrawState,
  text: string,
  options: { bold?: boolean; color?: ReturnType<typeof rgb>; size?: number } = {},
): void {
  const size = options.size ?? 10;
  const lines = wrapInvoiceText(text, size >= 12 ? 66 : 88);
  ensureRoom(state, Math.max(1, lines.length) * (size + 4));

  for (const line of lines) {
    state.page.drawText(line, {
      color: options.color ?? rgb(0.043, 0.145, 0.271),
      font: options.bold ? state.bold : state.regular,
      size,
      x: 48,
      y: state.y,
    });
    state.y -= size + 4;
  }
}

async function renderInvoice(
  invoice: InvoiceSnapshot,
  organization: OrganizationSnapshot,
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([595.28, 841.89]);
  const state: DrawState = { bold, document, page, regular, y: 760 };

  page.drawRectangle({
    color: rgb(0.043, 0.145, 0.271),
    height: 102,
    width: 595.28,
    x: 0,
    y: 739.89,
  });
  page.drawRectangle({
    color: rgb(0.949, 0.439, 0.114),
    height: 102,
    width: 8,
    x: 0,
    y: 739.89,
  });
  page.drawText(organization.name, {
    color: rgb(1, 1, 1),
    font: bold,
    size: 24,
    x: 48,
    y: 786,
  });
  page.drawText("COMMERCIAL INVOICE · NON-GST", {
    color: rgb(1, 0.94, 0.88),
    font: bold,
    size: 10,
    x: 48,
    y: 766,
  });
  page.drawText(invoice.invoice_number, {
    color: rgb(1, 1, 1),
    font: bold,
    size: 13,
    x: 385,
    y: 782,
  });
  page.drawText(`Issued ${new Date(invoice.created_at).toLocaleDateString("en-IN")}`, {
    color: rgb(0.9, 0.92, 0.96),
    font: regular,
    size: 9,
    x: 385,
    y: 764,
  });

  state.y = 710;
  drawWrapped(state, "BILL TO", { bold: true, color: rgb(0.949, 0.439, 0.114), size: 9 });
  drawWrapped(state, invoice.client_name, { bold: true, size: 13 });
  drawWrapped(state, invoice.customer_phone_e164);
  if (invoice.customer_email) drawWrapped(state, invoice.customer_email);
  state.y -= 8;

  drawWrapped(state, "EVENT DETAILS", {
    bold: true,
    color: rgb(0.949, 0.439, 0.114),
    size: 9,
  });
  drawWrapped(state, `${invoice.event_type} · ${invoice.event_date}`);
  drawWrapped(state, `${invoice.guest_count.toLocaleString("en-IN")} guests · ${invoice.venue}`);
  state.y -= 12;

  ensureRoom(state, 90);
  state.page.drawRectangle({
    borderColor: rgb(0.88, 0.9, 0.94),
    borderWidth: 1,
    color: rgb(0.97, 0.98, 0.99),
    height: 28,
    width: 499,
    x: 48,
    y: state.y - 19,
  });
  state.page.drawText("DESCRIPTION", {
    color: rgb(0.36, 0.42, 0.52),
    font: bold,
    size: 8,
    x: 58,
    y: state.y - 8,
  });
  state.page.drawText("AMOUNT", {
    color: rgb(0.36, 0.42, 0.52),
    font: bold,
    size: 8,
    x: 455,
    y: state.y - 8,
  });
  state.y -= 42;
  drawWrapped(state, invoice.service_description);
  state.page.drawText(formatInrAmount(invoice.subtotal), {
    color: rgb(0.043, 0.145, 0.271),
    font: regular,
    size: 10,
    x: 445,
    y: state.y + 14,
  });
  state.y -= 18;
  state.page.drawLine({
    color: rgb(0.88, 0.9, 0.94),
    end: { x: 547, y: state.y },
    start: { x: 340, y: state.y },
    thickness: 1,
  });
  state.y -= 25;
  state.page.drawText("TOTAL", {
    color: rgb(0.043, 0.145, 0.271),
    font: bold,
    size: 11,
    x: 385,
    y: state.y,
  });
  state.page.drawText(formatInrAmount(invoice.total), {
    color: rgb(0.949, 0.439, 0.114),
    font: bold,
    size: 13,
    x: 445,
    y: state.y,
  });
  state.y -= 40;

  if (invoice.payment_instructions) {
    drawWrapped(state, "PAYMENT INSTRUCTIONS", {
      bold: true,
      color: rgb(0.949, 0.439, 0.114),
      size: 9,
    });
    drawWrapped(state, invoice.payment_instructions);
    state.y -= 8;
  }

  drawWrapped(state, "TERMS", {
    bold: true,
    color: rgb(0.949, 0.439, 0.114),
    size: 9,
  });
  drawWrapped(state, invoice.terms, { color: rgb(0.36, 0.42, 0.52), size: 9 });

  for (const invoicePage of document.getPages()) {
    invoicePage.drawText(`Generated securely by Khana Banao CRM · ${invoice.invoice_number}`, {
      color: rgb(0.48, 0.53, 0.62),
      font: regular,
      size: 8,
      x: 48,
      y: 28,
    });
  }

  return document.save();
}

export async function generateAndStoreInvoice(
  admin: SupabaseClient,
  invoiceId: string,
): Promise<GeneratedInvoice> {
  const invoiceResult = await admin.from("invoices").select("*").eq("id", invoiceId).single();
  if (invoiceResult.error) throw fromDatabaseError(invoiceResult.error);
  const invoice = parseInvoice(invoiceResult.data);

  if (invoice.status === "void") {
    throw new AppError("VALIDATION_FAILED", { details: { reason: "INVOICE_VOID" } });
  }

  const existing = await existingInvoice(admin, invoice);
  if (existing) return existing;

  const organizationResult = await admin
    .from("organizations")
    .select("name,currency")
    .eq("id", record(invoiceResult.data).organization_id)
    .single();
  if (organizationResult.error) throw fromDatabaseError(organizationResult.error);
  const organization = parseOrganization(organizationResult.data);

  try {
    const bytes = await renderInvoice(invoice, organization);
    const organizationId = stringValue(
      record(invoiceResult.data).organization_id,
      "organization_id",
    );
    const storagePath = `${organizationId}/${invoice.booking_id}/${invoice.id}.pdf`;
    const upload = await admin.storage.from("invoices").upload(storagePath, bytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (upload.error) throw fromDatabaseError(upload.error);

    const update = await admin
      .from("invoices")
      .update({
        issued_at: new Date().toISOString(),
        pdf_storage_path: storagePath,
        status: "issued",
      })
      .eq("id", invoice.id)
      .in("status", ["pending_generation", "generation_failed"]);
    if (update.error) throw fromDatabaseError(update.error);

    return {
      bytes,
      fileName: `${invoice.invoice_number}.pdf`,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      storagePath,
    };
  } catch (error) {
    await admin
      .from("invoices")
      .update({ status: "generation_failed" })
      .eq("id", invoice.id)
      .in("status", ["pending_generation", "generation_failed"]);
    throw error;
  }
}
