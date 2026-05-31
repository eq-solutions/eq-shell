# Spec: EQ Cards — OCR onboarding flow
**Status:** APPROVED — decisions locked 2026-06-01. Ready for D3.3 build.
**Design ref:** `EQ Cards - Onboarding.html` (Direction D handoff bundle)
**Task:** D3.1 → feeds into D3.3 build wave

## Confirmed decisions (2026-06-01)
| # | Question | Decision |
|---|---|---|
| Q1 | OCR provider | Google Vision API |
| Q2 | Document storage | eq-canonical (control plane, `jvknxcmbtrfnxfrwfimn`) |
| Q3 | Platform | Both — Flutter Cards app (primary) + Shell-hosted React fallback |
| Q4 | Admin on behalf | Self-service only |
| Q5 | Document type list | Define as part of D3.3 — eq-intake does NOT yet have a licence kind enum |
| Q6 | Multi-document | Multi — user can upload several licences in one session |

---

## What it is

A mobile-first onboarding flow inside EQ Cards that lets a worker (or HR admin onboarding on their behalf) scan a licence or certificate document, have the key fields parsed automatically, review the parsed data, correct any errors, and confirm — which emits the record to eq-intake for canonical ingestion.

**Scope is licences and certificates only.** Payroll, banking, and super details are handled externally and are explicitly out of scope for this flow.

The design handoff names this "Scan licence → OCR auto-fill". The screen is within EQ Cards (Flutter web app), not a Shell-hosted web view, unless a Shell-hosted fallback is required for non-Flutter contexts.

---

## Where it lives

**Primary:** EQ Cards Flutter web app. The onboarding flow is a multi-step screen sequence within the Flutter app.

**Fallback consideration:** If a Shell-hosted web view is needed (e.g. for use in the Shell iframe context, or for a browser-only flow without the Cards Flutter app), the flow can be a React page in Shell. Confirm with Royce before building. The spec covers both options, but the Flutter path is primary.

---

## Flow overview

```
Upload / Camera → Parsing (skeleton) → Review (field-by-field) → Confirm → Emitted
```

Four screens. Each is a full-page step within a stepper — no sidebar, no top nav during the flow. A "X of 4" step indicator sits at the top.

---

## Screen 1: Upload / Camera

### Purpose
Capture the licence or certificate image or PDF.

### Layout
- Centred card, max-width 480px on tablet/desktop, full-width on mobile.
- Heading: "Add a licence or certificate"
- Body: "Take a photo or upload a file. We'll read the details automatically."
- Two buttons:
  - "Take a photo" (primary) — triggers device camera (Flutter: `image_picker` with `ImageSource.camera`)
  - "Upload a file" (ghost) — file picker, accepts PDF, JPG, PNG
- Below buttons: small grey text listing supported formats: "PDF, JPG or PNG · up to 10 MB"
- Optional: drag-and-drop zone on desktop (Flutter web supports this)

### States
- Default: as above
- File selected: small preview thumbnail (image) or file name + size (PDF) appears below the buttons, with a "Remove" link and a "Continue" primary button
- Error — file too large: inline error beneath the file zone: "That file is too large. Maximum size is 10 MB."
- Error — unsupported format: "That file type isn't supported. Use PDF, JPG or PNG."

### Technical note
Maximum file size: 10 MB (confirm — 10 MB covers most scanned PDFs and phone photos). Accepted MIME types: `image/jpeg`, `image/png`, `application/pdf`.

---

## Screen 2: Parsing (skeleton state)

### Purpose
Show that OCR is running and keep the user informed. Never show a blank page or a spinner on white.

### Layout
- Heading: "Reading your document…"
- Body: "This usually takes a few seconds."
- Below: a skeleton list of 5–6 field rows — each row is a grey rectangle for the label and a wider grey rectangle for the value. This previews the review step so the user knows what's coming.
- A Lucide `ScanLine` icon (or `FileSearch`) animated with a slow opacity pulse (150ms ease as per tokens, `prefers-reduced-motion` respected — reduce to no animation).
- No cancel button during parsing. If parsing takes more than 15 seconds, show: "Taking longer than usual…" with a "Cancel" ghost button.

### Where OCR runs

**Recommended: Netlify function.** The Cards Flutter app calls a Netlify function endpoint (e.g. `POST /.netlify/functions/ocr-parse`) with the file as a multipart upload. The function runs the OCR (using a third-party vision API — Google Vision, AWS Textract, or the Supabase AI/edge function path) and returns structured JSON.

Alternatives:
- **Supabase edge function** (`supabase/functions/ocr-parse`) — keeps processing on the same platform as the data. Viable if Supabase storage is already used for Cards documents.
- **Client-side OCR** (e.g. Tesseract.js) — not recommended. Quality is lower for licences, and Flutter web WASM overhead is significant.

The parsed JSON response shape (what the Netlify/edge function returns):

```json
{
  "licence_number": "123456789",
  "licence_class": "HC",
  "expiry_date": "2026-09-30",
  "issuing_authority": "Transport for NSW",
  "full_name": "Jane Smith",
  "date_of_birth": "1985-04-12",
  "confidence": {
    "licence_number": 0.98,
    "expiry_date": 0.91,
    "full_name": 0.85
  }
}
```

Fields with confidence below 0.80 are flagged as "needs review" on Screen 3.

### Error state

If OCR fails (network error, unreadable document):
- Replace skeleton with an error state: "We couldn't read that document."
- Two options: "Try again" (primary) and "Enter details manually" (ghost — skips to Screen 3 with empty fields).

---

## Screen 3: Review

### Purpose
Let the user check and correct every parsed field before submitting. This is the most important screen — a wrong licence class or expiry date causes downstream data quality issues.

### Layout
- Heading: "Check the details"
- Body: "We've read these from your document. Fix anything that's wrong."
- A `FormInput` for each field (using the `@eq-solutions/ui` FormInput component):
  - Licence / certificate number
  - Document type (dropdown: Driver Licence, White Card, Forklift Licence, EWP, etc. — pull the canonical list from eq-intake's known kinds)
  - Licence class (text input, optional)
  - Expiry date (date picker or text input formatted `DD/MM/YYYY`)
  - Issuing authority (text input)
  - Full name (pre-populated — read-only if already set on the user's profile, editable if not)
  - Date of birth (read-only if already on profile)

Fields with low-confidence OCR results are highlighted: `error` state on the `FormInput` with hint text "Double-check this — we're not sure we read it correctly."

- At bottom: "Continue" primary button. Disabled until all required fields are filled.
- "Start over" ghost button — returns to Screen 1.

### Validation
- Expiry date must be a valid date. If in the past: warning hint "This has expired — it will still be saved but marked as expired."
- Licence number: no format enforcement (formats vary by state and licence type), but must not be empty.
- Required fields: document type, licence number, expiry date.

---

## Screen 4: Confirm

### Purpose
Final review before emitting. One-shot — once submitted, the record goes to eq-intake.

### Layout
- Heading: "Ready to save?"
- A read-only summary of all fields (label + value, list style — not a form).
- Document thumbnail (small, top-right of summary card).
- "Save licence" primary button.
- "Edit" ghost button — returns to Screen 3.

A `ConfirmDialog` is triggered by "Save licence" (not a separate page). Dialog:
- Title: "Save this licence?"
- Body: "The details will be added to [worker name]'s profile."
- Actions: "Save" (primary) and "Cancel".

On confirm: `POST` to the intake-commit endpoint.

---

## Output: how parsed data flows to eq-intake

The confirm action calls the existing intake-commit orchestrator endpoint. It does not write directly to Supabase — it goes through the intake pipeline.

Endpoint (existing): `POST /.netlify/functions/intake-commit` (or equivalent in eq-intake).

Payload shape:

```json
{
  "entity": "licence",
  "source_app": "cards",
  "rows": [
    {
      "licence_number": "123456789",
      "licence_class": "HC",
      "expiry_date": "2026-09-30",
      "issuing_authority": "Transport for NSW",
      "document_type": "driver_licence",
      "worker_id": "<supabase user id>",
      "document_url": "<Supabase storage URL of uploaded file>"
    }
  ]
}
```

The intake pipeline validates, deduplicates (if licence_number + worker_id already exists, update rather than insert), and commits to the canonical licences table.

The uploaded document file should be stored in Supabase Storage (Cards bucket) before the intake-commit call, so the `document_url` is a stable Supabase Storage URL.

---

## Post-submit

After successful intake-commit:
- Show a success state within Screen 4: Lucide `CheckCircle2` icon, "Licence saved" heading, "It's on [worker name]'s profile" body.
- Two buttons: "Add another" (returns to Screen 1) and "Done" (returns to Cards home).

On intake-commit failure:
- Show the `EqError` component: "Couldn't save the licence. Your information isn't lost — try again or contact support."
- "Try again" retries the intake-commit with the same payload (the file is already uploaded).

---

## Open questions for Royce

1. **OCR provider**: Which OCR service should be used? Options: Google Vision API (best accuracy on Australian licences), AWS Textract, Supabase AI. This affects infra setup — the Netlify function needs the API key as an env var. Google Vision is recommended given EQ's existing Google tooling exposure.

2. **File storage**: Should uploaded licence documents be stored in Supabase Storage (Cards bucket) or somewhere else? Confirm which Supabase project (eq-canonical or eq-canonical-internal) holds Cards documents.

3. **Flutter vs Shell-hosted web view**: Is this flow being built inside the Cards Flutter app (primary) or as a Shell-hosted React page? If Shell-hosted, the file upload and preview need to be React-based, and the Netlify function is called from Shell rather than from Cards.

4. **Admin vs worker**: Can an admin run this flow on behalf of a worker (by selecting a worker from a dropdown on Screen 1)? Or is the flow always self-service (worker runs it on their own device)? The spec assumes self-service but the intake payload includes a `worker_id` that could be set by an admin.

5. **Supported document types**: The "document type" dropdown needs a canonical list. Confirm whether eq-intake already has a licence kind enum, or if this needs to be defined for D3.3.

6. **Multi-document upload**: Should a worker be able to upload multiple licences in one session (e.g. driver licence + white card in the same flow)? The spec covers one document per flow. "Add another" at the end supports sequential uploads without re-entering the flow.
