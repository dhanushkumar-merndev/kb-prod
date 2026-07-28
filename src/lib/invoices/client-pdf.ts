import type { BookingRecord } from "@/features/bookings/types";

function wrap(value: string, maximumCharacters: number): string[] {
  const words = value.replace(/\s+/gu, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maximumCharacters) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
  }

  if (line) lines.push(line);
  return lines;
}

function inr(value: string): string {
  return `INR ${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(Number(value))}`;
}

export async function downloadBookingInvoicePdf(booking: BookingRecord): Promise<void> {
  if (!booking.invoice) {
    throw new Error("INVOICE_RECORD_REQUIRED");
  }

  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([595.28, 841.89]);
  let y = 705;

  page.drawRectangle({
    color: rgb(0.043, 0.145, 0.271),
    height: 112,
    width: 595.28,
    x: 0,
    y: 729.89,
  });
  page.drawRectangle({
    color: rgb(0.949, 0.439, 0.114),
    height: 112,
    width: 8,
    x: 0,
    y: 729.89,
  });
  page.drawText("Khana Banao", {
    color: rgb(1, 1, 1),
    font: bold,
    size: 25,
    x: 44,
    y: 786,
  });
  page.drawText("COMMERCIAL INVOICE - NON-GST", {
    color: rgb(1, 0.94, 0.88),
    font: bold,
    size: 10,
    x: 44,
    y: 765,
  });
  page.drawText(booking.invoice.number, {
    color: rgb(1, 1, 1),
    font: bold,
    size: 12,
    x: 382,
    y: 785,
  });
  page.drawText(`Issued ${new Date().toLocaleDateString("en-IN")}`, {
    color: rgb(0.9, 0.92, 0.96),
    font: regular,
    size: 9,
    x: 382,
    y: 765,
  });

  const drawLabel = (value: string) => {
    page.drawText(value, {
      color: rgb(0.949, 0.439, 0.114),
      font: bold,
      size: 9,
      x: 44,
      y,
    });
    y -= 18;
  };
  const drawText = (value: string, strong = false) => {
    for (const line of wrap(value, 82)) {
      page.drawText(line, {
        color: rgb(0.043, 0.145, 0.271),
        font: strong ? bold : regular,
        size: strong ? 12 : 10,
        x: 44,
        y,
      });
      y -= strong ? 17 : 14;
    }
  };

  drawLabel("BILL TO");
  drawText(booking.clientName, true);
  if (booking.customerEmail) drawText(booking.customerEmail);
  y -= 10;

  drawLabel("BOOKING & EVENT");
  drawText(`Booking: ${booking.bookingCode}`);
  drawText(`${booking.eventType} on ${booking.eventDate}`);
  drawText(`${booking.guestCount.toLocaleString("en-IN")} guests`);
  drawText(booking.venue);
  y -= 16;

  page.drawRectangle({
    borderColor: rgb(0.88, 0.9, 0.94),
    borderWidth: 1,
    color: rgb(0.97, 0.98, 0.99),
    height: 30,
    width: 507,
    x: 44,
    y: y - 20,
  });
  page.drawText("DESCRIPTION", {
    color: rgb(0.36, 0.42, 0.52),
    font: bold,
    size: 8,
    x: 54,
    y: y - 9,
  });
  page.drawText("AMOUNT", {
    color: rgb(0.36, 0.42, 0.52),
    font: bold,
    size: 8,
    x: 438,
    y: y - 9,
  });
  y -= 48;
  drawText(`Catering service for ${booking.eventType}`);
  page.drawText(inr(booking.totalValue), {
    color: rgb(0.043, 0.145, 0.271),
    font: regular,
    size: 10,
    x: 430,
    y: y + 14,
  });
  y -= 28;

  page.drawLine({
    color: rgb(0.88, 0.9, 0.94),
    end: { x: 551, y },
    start: { x: 350, y },
    thickness: 1,
  });
  y -= 28;
  page.drawText("TOTAL", {
    color: rgb(0.043, 0.145, 0.271),
    font: bold,
    size: 11,
    x: 385,
    y,
  });
  page.drawText(inr(booking.totalValue), {
    color: rgb(0.949, 0.439, 0.114),
    font: bold,
    size: 13,
    x: 430,
    y,
  });
  y -= 55;

  drawLabel("TERMS");
  drawText("This is a commercial invoice and not a GST tax invoice.");
  drawText("Please use the booking code as the payment reference.");

  page.drawText(`Generated locally by Khana Banao CRM - ${booking.invoice.number}`, {
    color: rgb(0.48, 0.53, 0.62),
    font: regular,
    size: 8,
    x: 44,
    y: 28,
  });

  const bytes = await document.save();
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.download = `${booking.invoice.number}.pdf`;
  anchor.href = url;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
