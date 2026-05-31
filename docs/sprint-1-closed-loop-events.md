# Sprint 1 — Closed-Loop Events & Payload Standardisation
**Applies to:** eq-solves-field, eq-solves-service, eq-quotes
**Requires access to:** those repos and their Supabase tenants
**Context:** EQ Shell AI briefing can only synthesise closed states if the source apps emit them.
**Emit pattern:** `SELECT eq_write_canonical_event(app_source, event, payload::jsonb)`

---

## Standard payload fields (all optional, include where applicable)

```json
{
  "reference":   "DEF-0221",       // human ID (defect ref, quote ref, WO number)
  "name":        "J. Thompson",    // person name
  "site_name":   "Site 4112",      // site name
  "value_cents": 85000,            // monetary value in cents
  "due_date":    "2026-06-04",     // ISO date for deadline
  "resolved_by": "Sarah Chen"      // who closed/resolved
}
```

---

## EQ Service — required events

### `defect.resolved`
Emit when a defect is marked resolved/closed.
```sql
SELECT eq_write_canonical_event(
  'service',
  'defect.resolved',
  jsonb_build_object(
    'reference',   defect_ref,        -- e.g. 'SLD-04'
    'site_name',   site_name,
    'resolved_by', resolved_by_name,
    'resolution',  resolution_note    -- optional short note
  )
);
```

### `defect.overdue`
Emit from a scheduled job (pg_cron or Netlify cron) for defects past SLA.
```sql
-- Run daily; find defects open > 24h
SELECT eq_write_canonical_event(
  'service',
  'defect.overdue',
  jsonb_build_object(
    'reference',  d.defect_ref,
    'site_name',  s.name,
    'hours_open', EXTRACT(EPOCH FROM (now() - d.created_at)) / 3600
  )
)
FROM defects d
JOIN sites s ON s.id = d.site_id
WHERE d.status NOT IN ('resolved', 'closed')
  AND d.created_at < now() - INTERVAL '24 hours'
  AND NOT EXISTS (
    -- Don't re-emit if already emitted today
    SELECT 1 FROM canonical_events
    WHERE event = 'defect.overdue'
      AND payload->>'reference' = d.defect_ref
      AND occurred_at > now() - INTERVAL '23 hours'
  );
```

### `wo.overdue`
Same pattern for work orders past their scheduled completion date.
```sql
SELECT eq_write_canonical_event(
  'service',
  'wo.overdue',
  jsonb_build_object(
    'reference',      wo.wo_number,
    'site_name',      s.name,
    'scheduled_date', wo.scheduled_date::text
  )
)
FROM work_orders wo
JOIN sites s ON s.id = wo.site_id
WHERE wo.status NOT IN ('completed', 'cancelled')
  AND wo.scheduled_date < CURRENT_DATE;
```

---

## EQ Field — required events

### `licence.renewed`
Emit when a licence record is updated with a new expiry date.
```sql
SELECT eq_write_canonical_event(
  'field',
  'licence.renewed',
  jsonb_build_object(
    'name',          person_name,
    'licence_type',  licence_type,    -- e.g. 'Electrical A-Grade'
    'new_expiry',    new_expiry_date::text,
    'renewed_by',    updated_by_name  -- optional
  )
);
```

### `licence.expired`
Emit from a scheduled daily job for licences that have passed their expiry.
```sql
SELECT eq_write_canonical_event(
  'field',
  'licence.expired',
  jsonb_build_object(
    'name',         p.name,
    'licence_type', l.licence_type,
    'expired_at',   l.expiry_date::text
  )
)
FROM licences l
JOIN people p ON p.id = l.person_id
WHERE l.expiry_date < CURRENT_DATE
  AND l.status != 'expired'   -- only emit once on transition
  AND NOT EXISTS (
    SELECT 1 FROM canonical_events
    WHERE event = 'licence.expired'
      AND payload->>'name' = p.name
      AND payload->>'licence_type' = l.licence_type
      AND occurred_at > now() - INTERVAL '25 hours'
  );
```

### `shift.ended`
Emit when a shift is closed out (clock-off or end-of-day roster processing).
```sql
SELECT eq_write_canonical_event(
  'field',
  'shift.ended',
  jsonb_build_object(
    'name',      person_name,
    'site_name', site_name,
    'ended_at',  ended_at::text
  )
);
```

---

## EQ Quotes — required events

### `quote.expired`
Emit when a quote passes its valid-until date without being accepted.
```sql
-- Scheduled daily
SELECT eq_write_canonical_event(
  'quotes',
  'quote.expired',
  jsonb_build_object(
    'reference',   q.reference,       -- e.g. 'Q-2026-0418'
    'client_name', q.client_name,
    'value_cents', (q.total_value * 100)::bigint
  )
)
FROM quotes q
WHERE q.status = 'sent'
  AND q.valid_until < CURRENT_DATE;
```

### `quote.declined`
Emit when a client explicitly declines a quote.
```sql
SELECT eq_write_canonical_event(
  'quotes',
  'quote.declined',
  jsonb_build_object(
    'reference',   reference,
    'client_name', client_name,
    'value_cents', (total_value * 100)::bigint,
    'reason',      decline_reason    -- optional
  )
);
```

---

## Payload audit — existing events to fix

Check each event type in `app_data.canonical_events` and confirm these fields are present:

| Event | Must include |
|---|---|
| `licence.expiring` | `name`, `licence_type`, `expires_at` |
| `defect.created`   | `reference`, `site_name`, `reported_by` |
| `quote.sent`       | `reference`, `client_name`, `value_cents` |
| `quote.created`    | `reference`, `client_name`, `value_cents` |
| `quote.accepted`   | `reference`, `client_name`, `value_cents` |
| `shift.started`    | `name`, `site_name`, `started_at` |
| `card.issued`      | `name`, `card_type` |
| `staff.onboarded`  | `name`, `role` |

Run this query against each tenant to find gaps:
```sql
SELECT event, payload
FROM app_data.canonical_events
WHERE occurred_at > now() - INTERVAL '30 days'
ORDER BY event, occurred_at DESC
LIMIT 5;
```

For each event, compare payload keys against the "must include" list above and fix the emit site.
