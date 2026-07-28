# Customer email, invoice, and lead-stage automation

## Implemented workflow

The workflow is milestone-driven and shared by manual CRM activity and normalized
Superfone records:

```text
new
  -> contacted                 answered/completed call or successful customer message
  -> follow_up                 open follow-up scheduled
contacted/follow_up
  -> qualified                manual; complete event, guests, requirement, and quote required
qualified
  -> booking_payment_pending  booking created; commercial invoice record created
booking_payment_pending
  -> booking_in_process       first positive payment verified; booking confirmed
booking_in_process
  -> won                      service completed and booking fully paid
```

`lost` and `unreachable` require a reason. They are rejected when an active booking exists.
Sales Members can act only on assigned records. Sales Manager, Manager, and Director have
audited reopen/override authority. Expected-version checks reject stale browser writes.

Failed, missed, busy, and unanswered calls do not mark a lead contacted.

## Invoice behavior

- One non-GST commercial invoice is issued when a qualified lead becomes a booking.
- Numbers are organization/year scoped, for example `KB-INV-2026-000001`.
- `pdf-lib` generates A4 PDFs inside a Supabase Edge Function.
- PDFs are stored in the private `invoices` bucket and downloaded through five-minute signed
  URLs.
- Issued invoice snapshots are not edited. Director, Manager, or Sales Manager must give a
  reason to void and reissue.
- Booking detail changes that affect an invoice snapshot create a replacement invoice; they do
  not overwrite history.
- Existing historical bookings are not backfilled automatically.

The output is not a GST tax invoice. Do not enable GST wording or tax lines until the
organization's GSTIN, registered address, place-of-supply rules, and applicable rates are
confirmed.

## Brevo behavior

Business transactions enqueue outbox records. Provider failures never roll back a booking or
payment. The processor claims due rows atomically, generates the invoice PDF when required,
sends through Brevo, stores safe provider status, and retries transient failures up to five
attempts with increasing delays.

The following customer events are queued:

- booking created/payment requested with invoice;
- payment verified/booking confirmed;
- payment proof rejected;
- service completed with balance due;
- booking fully completed and paid, with the invoice attached.

A missing customer email creates a visible `skipped` outbox result. It does not block the
workflow. `delivered` is displayed only after a valid Brevo webhook confirms it.

## Required secrets

Configure these only as Supabase Edge Function secrets:

```env
BREVO_API_KEY=
BREVO_SENDER_EMAIL=
BREVO_SENDER_NAME=Khana Banao
BREVO_WEBHOOK_SECRET=
```

The Director's Integrations page contains non-secret sender/invoice settings, the automation
switch, safe health information, connection testing, and a manual queue-processing control.
The configured organization sender must be verified in the same Brevo account.

## Production activation checklist

1. Keep `email_automation_enabled` off during deployment.
2. Verify the sender domain in Brevo.
3. Publish and validate SPF, DKIM, and DMARC.
4. Deploy `brevo-test-connection`, `generate-booking-invoice`,
   `process-email-outbox`, and `brevo-webhook`.
5. Register the webhook URL with Brevo:

   ```text
   https://<project-ref>.supabase.co/functions/v1/brevo-webhook?token=<BREVO_WEBHOOK_SECRET>
   ```

6. Subscribe to sent, delivered, deferred, hard/soft bounce, blocked, invalid, and spam events.
7. Schedule `process-email-outbox` every minute with an `Authorization: Bearer
<SUPABASE_SERVICE_ROLE_KEY>` header using Supabase Cron or the platform scheduler. Do not
   expose this token in client code or SQL migration text.
8. Test one controlled recipient and verify the PDF, outbox row, provider message ID, and
   webhook delivery event.
9. Turn on automation from Director -> Integrations.
10. Monitor queued/failed counts and keep the configured daily cap at or below the provider
    allowance.

Free Brevo accounts should be opened periodically to avoid inactivity removal. Provider plan
limits and branding can change; confirm the current Brevo terms before production activation.
