# ADR-001 — Icon system: Lucide, scoped (not blanket)

**Status:** Accepted (2026-05-31) · Direction D, wave D2
**Decision owner:** Royce

## Context
Direction D's handoff called for "Lucide everywhere." The EQ apps run on four
different stacks (Shell + Service = React, Field = vanilla JS, Cards = Flutter),
each with a different icon situation. A literal "everywhere" mandate would mean a
Flutter Material→Lucide retrofit in Cards and a big-bang rewrite of Field's
bespoke inline SVGs — high cost, low/negative value.

## Decision
**Lucide is the icon family. Adoption is scoped:**

- **React apps (Shell, Service):** Lucide for all *meaningful* icons (alerts,
  status, actions). Already on `lucide-react`. Decorative typography (arrows `→`,
  bullets) stays as-is — it isn't iconography.
- **Field (vanilla JS):** adopt Lucide *opportunistically* on new/touched screens.
  No mass conversion of the live, SKS-critical app. A small Lucide SVG helper makes
  it available.
- **Cards (Flutter):** **keep Material Icons.** They are native, zero-dependency,
  and internally consistent. Lucide only for net-new Cards screens, if ever — no
  retrofit.

## Rationale
Icon inconsistency is only perceptible at the **seams** — where Shell hosts
Field/Cards/Service iframes side by side — and the Shell chrome is already Lucide,
so the unifying layer is done. Within a single app, internal consistency is what a
user feels; Cards-with-Material is internally consistent. A blanket retrofit would
spend real effort (and add a third-party Flutter dep) for ~identical pixels.

## Consequences
- New React/Field icons default to Lucide.
- Cards stays on Material; do not schedule a Lucide retrofit.
- No "Lucide everywhere" sweep across all four stacks.
