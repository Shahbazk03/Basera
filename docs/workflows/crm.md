# Enquiries & CRM

## From enquiry to lead

```mermaid
sequenceDiagram
  participant V as Visitor
  participant W as Website
  participant A as API (POST /public/enquiries)
  participant DB as PostgreSQL
  participant Q as Notification outbox
  V->>W: Fills enquiry / callback / site-visit / WhatsApp form
  W->>A: enquirySchema payload + attribution (UTM, page, referrer)
  A->>A: Rate limit · honeypot · fill-time check · optional Turnstile · phone normalisation
  A->>DB: BEGIN
  A->>DB: Upsert customer (per organisation, by phone)
  A->>DB: Create enquiry (ENQ-YYYY-NNNNNN)
  A->>DB: Open lead for this phone within the duplicate window? attach : create lead (LD-…)
  A->>DB: Activity "Enquiry received"; site-visit request when asked
  A->>DB: Assignment rule → assignee (history + activity)
  A->>Q: enquiry.received (team) · enquiry.acknowledgement (customer) · lead.assigned
  A->>DB: COMMIT
  A-->>W: { referenceNo, message, whatsappUrl? }
  Q-->>Q: Deliver after commit (BullMQ / poller), retries with backoff
```

- The receiving organisation is the listing's organisation (broker, developer, owner) or the project's managing organisation; general enquiries go to the platform company.
- **Duplicates** are never silently dropped: repeat enquiries from the same phone attach to the open lead with an activity; lead-provider duplicates are stored with `intakeStatus = DUPLICATE` and a link to the original.
- **WhatsApp**: the visitor leaves name + phone first (so the business has the lead), then receives a `wa.me` link to the configured number; numbers are never exposed without a captured lead.

## Assignment engine
Rules are evaluated in priority order per organisation; the first rule whose conditions all match (project, cities, localities, sources, listing type) selects a **sales team** and a strategy:
- **Round robin** — next member after the last assignee.
- **Workload** — member with the fewest open leads (ties broken round-robin); members at `maxOpenLeadsPerUser` are skipped.
If no rule matches or nobody is eligible, the lead stays **unassigned** and appears in the unassigned queue. Every assignment (automatic or manual) is recorded in `lead_assignments` with method, rule and reason. Pure logic: `pickAssignee` and `matchAssignmentRule` in `@estate/shared` (unit-tested).

## Lead lifecycle
`NEW → ASSIGNED → CONTACTED / NOT_REACHABLE → INTERESTED → SITE_VISIT_SCHEDULED → SITE_VISIT_COMPLETED → NEGOTIATION → BOOKING_PENDING → CONVERTED`, with `FOLLOW_UP` and `LOST` (reason required) reachable from open states. Allowed manual moves are defined in `LEAD_STATUS_TRANSITIONS`. Calls, WhatsApp messages, emails, notes, meetings, status changes, assignments, follow-ups and site visits form one timeline (`lead_activities`).

## Follow-ups and site visits
- Follow-ups have a due time; a scheduler sends a reminder shortly before (once) and marks follow-ups overdue by more than a day as **missed**.
- Site visits move the lead to `SITE_VISIT_SCHEDULED`; completing one moves it to `SITE_VISIT_COMPLETED` and records the outcome.

## Deals and bookings
A deal is recorded from a lead (no online payment). Booking a project unit marks it **BOOKED** atomically (a second deal for the same unit fails); closing the deal marks the unit **SOLD**, the lead **CONVERTED** and resale listings **SOLD/RENTED**; cancellation releases the unit. Customer money received is recorded as deal payments — separate from company revenue (payments the company itself receives are mirrored in the ledger as `CUSTOMER_PAYMENT` inflows; see [finance](finance.md)).

## Lead providers
Partners submit leads one by one or by CSV. Each submission is accepted, flagged as duplicate (within the provider's duplicate window) or held for review. Providers see only their own submissions with intake and pipeline status, and their commission statement.
