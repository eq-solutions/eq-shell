// Shell-hosted 4-screen licence OCR onboarding flow (D3.3d).
//
// This is the browser fallback for Cards OCR — a fully self-contained React
// flow inside Shell so users who can't use the native Cards app can still
// upload and save a licence or certificate.
//
// Route: /:tenantSlug/onboarding/licence (wrapped in RequireSession)
// Flow:  Upload → Parsing → Review → Confirm

import { useCallback, useEffect, useRef, useState, useId, type ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ScanLine, CheckCircle2, Upload, Camera } from 'lucide-react';
import { Button, FormInput, ConfirmDialog } from '@eq-solutions/ui';
import { Skeleton } from '../../components/Skeleton';
import { EqLogo } from '../../components/EqLogo';
import { useSession } from '../../session';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LICENCE_KINDS = [
  { value: 'driver_licence',      label: 'Driver Licence' },
  { value: 'white_card',          label: 'White Card' },
  { value: 'forklift_licence',    label: 'Forklift Licence' },
  { value: 'ewp_licence',         label: 'EWP Licence' },
  { value: 'electrical_licence',  label: 'Electrical Licence' },
  { value: 'plumbing_licence',    label: 'Plumbing Licence' },
  { value: 'working_at_heights',  label: 'Working at Heights Certificate' },
  { value: 'first_aid',           label: 'First Aid Certificate' },
  { value: 'other',               label: 'Other' },
] as const;

type LicenceKind = (typeof LICENCE_KINDS)[number]['value'];

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'application/pdf'] as const;
type AcceptedMime = (typeof ACCEPTED_MIME)[number];

// ---------------------------------------------------------------------------
// OCR-parsed fields
// ---------------------------------------------------------------------------

interface ParsedField<T = string> {
  value: T;
  confidence: number; // 0–1
}

interface OcrResult {
  document_type?:    ParsedField<LicenceKind>;
  licence_number?:   ParsedField;
  licence_class?:    ParsedField;
  expiry_date?:      ParsedField;
  issuing_authority?: ParsedField;
  full_name?:        ParsedField;
  date_of_birth?:    ParsedField;
}

// The review form fields (all strings so we can bind them to inputs).
interface ReviewFields {
  document_type:     string;
  licence_number:    string;
  licence_class:     string;
  expiry_date:       string;
  issuing_authority: string;
  full_name:         string;
  date_of_birth:     string;
}

// Per-field confidence map for showing "double-check" warnings.
type FieldConfidence = Partial<Record<keyof ReviewFields, number>>;

function ocrToReview(ocr: OcrResult): { fields: ReviewFields; confidence: FieldConfidence } {
  const fields: ReviewFields = {
    document_type:     ocr.document_type?.value     ?? '',
    licence_number:    ocr.licence_number?.value    ?? '',
    licence_class:     ocr.licence_class?.value     ?? '',
    expiry_date:       ocr.expiry_date?.value       ?? '',
    issuing_authority: ocr.issuing_authority?.value ?? '',
    full_name:         ocr.full_name?.value         ?? '',
    date_of_birth:     ocr.date_of_birth?.value     ?? '',
  };
  const confidence: FieldConfidence = {
    document_type:     ocr.document_type?.confidence,
    licence_number:    ocr.licence_number?.confidence,
    licence_class:     ocr.licence_class?.confidence,
    expiry_date:       ocr.expiry_date?.confidence,
    issuing_authority: ocr.issuing_authority?.confidence,
    full_name:         ocr.full_name?.confidence,
    date_of_birth:     ocr.date_of_birth?.confidence,
  };
  return { fields, confidence };
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function parseDdMmYyyy(s: string): Date | null {
  const m = DATE_RE.exec(s.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (
    d.getFullYear() !== Number(yyyy) ||
    d.getMonth() !== Number(mm) - 1 ||
    d.getDate() !== Number(dd)
  ) {
    return null;
  }
  return d;
}

function isExpired(s: string): boolean {
  const d = parseDdMmYyyy(s);
  if (!d) return false;
  return d < new Date();
}

// ---------------------------------------------------------------------------
// File → base64
// ---------------------------------------------------------------------------

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data-url prefix (data:<mime>;base64,)
      resolve(result.split(',')[1] ?? result);
    };
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Minimal layout for onboarding (no sidebar)
// ---------------------------------------------------------------------------

function OcrLayout({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100svh',
      background: 'var(--eq-surface, #F9FAFB)',
    }}>
      {/* Top bar */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '16px 24px',
        borderBottom: '1px solid var(--eq-border, #E5E7EB)',
        background: '#fff',
      }}>
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Go back"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--eq-ink, #1A1A2E)',
              display: 'flex',
              alignItems: 'center',
              padding: 4,
              borderRadius: 6,
            }}
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <EqLogo size={28} />
      </header>

      {/* Content */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '32px 16px 64px',
      }}>
        {children}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Centred card wrapper
// ---------------------------------------------------------------------------

function OcrCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      width: '100%',
      maxWidth: 480,
      background: '#fff',
      border: '1px solid var(--eq-border, #E5E7EB)',
      borderRadius: 12,
      padding: '32px 28px',
      display: 'flex',
      flexDirection: 'column',
      gap: 20,
    }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <p style={{
      fontSize: 12,
      color: '#9CA3AF',
      margin: 0,
      letterSpacing: '0.02em',
    }}>
      Step {step} of {total}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Skeleton rows for parsing step
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Skeleton variant="text" width="35%" height={12} />
      <Skeleton variant="text" width="70%" height={18} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Read-only field row for confirm step
// ---------------------------------------------------------------------------

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ fontSize: 15, color: 'var(--eq-ink, #1A1A2E)' }}>
        {value}
      </span>
    </div>
  );
}

function kindLabel(value: string): string {
  return LICENCE_KINDS.find((k) => k.value === value)?.label ?? value;
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

type OcrStep = 1 | 2 | 3 | 4;

export default function LicenceOcrPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const navigate = useNavigate();
  const { session } = useSession();

  const [step, setStep] = useState<OcrStep>(1);

  // Step 1 — file
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [fileMime, setFileMime] = useState<AcceptedMime | null>(null);

  // Step 2 — parsing
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrSlow, setOcrSlow] = useState(false);
  const ocrAbortRef = useRef<AbortController | null>(null);
  const ocrSlowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 3 — review
  const [fields, setFields] = useState<ReviewFields>({
    document_type: '',
    licence_number: '',
    licence_class: '',
    expiry_date: '',
    issuing_authority: '',
    full_name: '',
    date_of_birth: '',
  });
  const [confidence, setConfidence] = useState<FieldConfidence>({});
  const [reviewErrors, setReviewErrors] = useState<Partial<Record<keyof ReviewFields, string>>>({});

  // Step 4 — confirm
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // ---------------------------------------------------------------------------
  // Step 1 — handle file selection
  // ---------------------------------------------------------------------------

  const handleFileSelect = useCallback(async (f: File) => {
    setFileError(null);

    if (!ACCEPTED_MIME.includes(f.type as AcceptedMime)) {
      setFileError('Only JPEG, PNG, or PDF files are accepted.');
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setFileError('The file is too large. Please upload something under 10 MB.');
      return;
    }

    setFile(f);
    setFileMime(f.type as AcceptedMime);

    try {
      const b64 = await fileToBase64(f);
      setFileBase64(b64);
    } catch {
      setFileError('Could not read the file. Try a different one.');
      setFile(null);
    }
  }, []);

  const onFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) void handleFileSelect(f);
      // Reset so the same file can be re-selected after an error
      e.target.value = '';
    },
    [handleFileSelect],
  );

  // ---------------------------------------------------------------------------
  // Step 2 — OCR call (triggered on mount of step 2)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (step !== 2 || !fileBase64 || !fileMime) return;

    setOcrError(null);
    setOcrSlow(false);

    const ctrl = new AbortController();
    ocrAbortRef.current = ctrl;

    ocrSlowTimerRef.current = setTimeout(() => {
      if (!ctrl.signal.aborted) setOcrSlow(true);
    }, 15_000);

    (async () => {
      try {
        const res = await fetch('/.netlify/functions/ocr-parse', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_base64: fileBase64, mime_type: fileMime }),
          signal: ctrl.signal,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }

        const data = await res.json() as OcrResult;
        const { fields: parsed, confidence: conf } = ocrToReview(data);
        setFields(parsed);
        setConfidence(conf);
        setStep(3);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setOcrError((err as Error).message || 'Unknown error');
      } finally {
        if (ocrSlowTimerRef.current) {
          clearTimeout(ocrSlowTimerRef.current);
          ocrSlowTimerRef.current = null;
        }
      }
    })();

    return () => {
      ctrl.abort();
      if (ocrSlowTimerRef.current) clearTimeout(ocrSlowTimerRef.current);
    };
  }, [step, fileBase64, fileMime]);

  // ---------------------------------------------------------------------------
  // Step 3 — validation
  // ---------------------------------------------------------------------------

  function validateReview(): boolean {
    const errs: Partial<Record<keyof ReviewFields, string>> = {};

    if (!fields.licence_number.trim()) {
      errs.licence_number = 'Licence or certificate number is required.';
    }

    if (!fields.expiry_date.trim()) {
      errs.expiry_date = 'Expiry date is required.';
    } else if (!parseDdMmYyyy(fields.expiry_date)) {
      errs.expiry_date = 'Enter the date as DD/MM/YYYY.';
    }

    setReviewErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function confidenceError(key: keyof ReviewFields): string | undefined {
    const c = confidence[key];
    if (c !== undefined && c < 0.8) {
      return "Double-check this — we're not sure we read it correctly.";
    }
    return undefined;
  }

  function reviewFieldError(key: keyof ReviewFields): string | undefined {
    return reviewErrors[key] ?? confidenceError(key);
  }

  // Required fields filled check for Continue button
  const reviewComplete =
    fields.licence_number.trim() !== '' &&
    fields.expiry_date.trim() !== '' &&
    !!parseDdMmYyyy(fields.expiry_date);

  // ---------------------------------------------------------------------------
  // Step 4 — save
  // ---------------------------------------------------------------------------

  const handleSave = useCallback(async () => {
    if (!session) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/.netlify/functions/intake-commit', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: 'licence',
          source_app: 'cards',
          rows: [{
            document_type:     fields.document_type || undefined,
            licence_number:    fields.licence_number,
            licence_class:     fields.licence_class || undefined,
            expiry_date:       fields.expiry_date,
            issuing_authority: fields.issuing_authority || undefined,
            full_name:         fields.full_name || undefined,
            date_of_birth:     fields.date_of_birth || undefined,
            worker_id:         session.user.id,
          }],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setSaved(true);
      setConfirmOpen(false);
    } catch (err) {
      setSaveError((err as Error).message || 'Something went wrong.');
      setConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  }, [session, fields]);

  function resetFlow() {
    setStep(1);
    setFile(null);
    setFileError(null);
    setFileBase64(null);
    setFileMime(null);
    setOcrError(null);
    setOcrSlow(false);
    setFields({ document_type: '', licence_number: '', licence_class: '', expiry_date: '', issuing_authority: '', full_name: '', date_of_birth: '' });
    setConfidence({});
    setReviewErrors({});
    setSaveError(null);
    setSaved(false);
  }

  // ---------------------------------------------------------------------------
  // Back navigation
  // ---------------------------------------------------------------------------

  function handleBack() {
    if (step === 1) {
      navigate(`/${tenantSlug ?? ''}`);
    } else if (step === 3) {
      setStep(1);
    } else if (step === 4) {
      setStep(3);
    } else {
      navigate(`/${tenantSlug ?? ''}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <OcrLayout onBack={saved ? undefined : handleBack}>

      {/* ── STEP 1: Upload ── */}
      {step === 1 && (
        <OcrCard>
          <StepIndicator step={1} total={4} />

          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--eq-ink, #1A1A2E)', lineHeight: 1.3 }}>
              Add a licence or certificate
            </h1>
            <p style={{ margin: '8px 0 0', color: '#6B7280', fontSize: 15 }}>
              Take a photo or upload a file. We'll read the details automatically.
            </p>
          </div>

          {/* Hidden file inputs */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            style={{ display: 'none' }}
            onChange={onFileInputChange}
            aria-hidden="true"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            style={{ display: 'none' }}
            onChange={onFileInputChange}
            aria-hidden="true"
          />

          {/* File preview */}
          {file && !fileError && (
            <div style={{
              border: '1px solid var(--eq-border, #E5E7EB)',
              borderRadius: 8,
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}>
              {file.type.startsWith('image/') ? (
                <img
                  src={`data:${file.type};base64,${fileBase64 ?? ''}`}
                  alt="Document preview"
                  style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                />
              ) : (
                <div style={{ width: 56, height: 56, background: '#F3F4F6', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280' }}>PDF</span>
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--eq-ink, #1A1A2E)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {file.name}
                </p>
                <p style={{ margin: 0, fontSize: 13, color: '#9CA3AF' }}>
                  {(file.size / 1024).toFixed(0)} KB
                </p>
              </div>
            </div>
          )}

          {fileError && (
            <p role="alert" style={{ margin: 0, fontSize: 13, color: '#DC2626' }}>
              {fileError}
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Button
              variant="secondary"
              icon={<Upload size={16} />}
              onClick={() => fileInputRef.current?.click()}
            >
              Upload a file
            </Button>
            <Button
              variant="ghost"
              icon={<Camera size={16} />}
              onClick={() => cameraInputRef.current?.click()}
            >
              Take a photo
            </Button>
          </div>

          {file && !fileError && (
            <Button
              disabled={!fileBase64}
              onClick={() => {
                if (fileBase64) setStep(2);
              }}
            >
              Continue
            </Button>
          )}
        </OcrCard>
      )}

      {/* ── STEP 2: Parsing ── */}
      {step === 2 && (
        <OcrCard>
          <StepIndicator step={2} total={4} />

          {ocrError ? (
            <>
              <div>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--eq-ink, #1A1A2E)' }}>
                  We couldn't read that document.
                </h1>
                <p style={{ margin: '8px 0 0', color: '#6B7280', fontSize: 15 }}>
                  {ocrError}
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Button onClick={() => { setOcrError(null); setStep(1); }}>
                  Try again
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setOcrError(null);
                    setFields({ document_type: '', licence_number: '', licence_class: '', expiry_date: '', issuing_authority: '', full_name: '', date_of_birth: '' });
                    setConfidence({});
                    setStep(3);
                  }}
                >
                  Enter details manually
                </Button>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <ScanLine
                  size={28}
                  style={{
                    color: 'var(--eq-sky, #3DA8D8)',
                    animation: 'eq-ocr-pulse 1.5s ease infinite',
                  }}
                  aria-hidden="true"
                />
                <div>
                  <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--eq-ink, #1A1A2E)' }}>
                    Reading your document…
                  </h1>
                  <p style={{ margin: '4px 0 0', color: '#6B7280', fontSize: 15 }}>
                    This usually takes a few seconds.
                  </p>
                </div>
              </div>

              {/* Skeleton preview — mimics review step */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {[1, 2, 3, 4, 5].map((i) => <SkeletonRow key={i} />)}
              </div>

              {ocrSlow && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <p style={{ margin: 0, fontSize: 13, color: '#9CA3AF' }}>
                    Taking longer than usual…
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      ocrAbortRef.current?.abort();
                      setStep(1);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </>
          )}
        </OcrCard>
      )}

      {/* ── STEP 3: Review ── */}
      {step === 3 && (
        <OcrCard>
          <StepIndicator step={3} total={4} />

          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--eq-ink, #1A1A2E)' }}>
              Check the details
            </h1>
            <p style={{ margin: '8px 0 0', color: '#6B7280', fontSize: 15 }}>
              We've read these from your document. Fix anything that's wrong.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Document type — native select with label pattern */}
            <DocumentTypeSelect
              value={fields.document_type}
              onChange={(v) => setFields((f) => ({ ...f, document_type: v }))}
              error={reviewFieldError('document_type')}
            />

            <FormInput
              label="Licence / certificate number"
              required
              value={fields.licence_number}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setFields((f) => ({ ...f, licence_number: e.target.value }))}
              error={reviewFieldError('licence_number')}
            />

            <FormInput
              label="Licence class (optional)"
              value={fields.licence_class}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setFields((f) => ({ ...f, licence_class: e.target.value }))}
              error={reviewFieldError('licence_class')}
            />

            <FormInput
              label="Expiry date"
              required
              type="text"
              placeholder="DD/MM/YYYY"
              value={fields.expiry_date}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setFields((f) => ({ ...f, expiry_date: e.target.value }))}
              error={reviewFieldError('expiry_date')}
              hint={
                fields.expiry_date && parseDdMmYyyy(fields.expiry_date) && isExpired(fields.expiry_date)
                  ? 'This has expired — it will still be saved but marked as expired.'
                  : undefined
              }
            />

            <FormInput
              label="Issuing authority"
              value={fields.issuing_authority}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setFields((f) => ({ ...f, issuing_authority: e.target.value }))}
              error={reviewFieldError('issuing_authority')}
            />

            <FormInput
              label="Full name"
              value={fields.full_name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setFields((f) => ({ ...f, full_name: e.target.value }))}
              error={reviewFieldError('full_name')}
            />

            <FormInput
              label="Date of birth (optional)"
              type="text"
              placeholder="DD/MM/YYYY"
              value={fields.date_of_birth}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setFields((f) => ({ ...f, date_of_birth: e.target.value }))}
              error={reviewFieldError('date_of_birth')}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Button
              disabled={!reviewComplete}
              onClick={() => {
                if (validateReview()) setStep(4);
              }}
            >
              Continue
            </Button>
            <Button variant="ghost" onClick={resetFlow}>
              Start over
            </Button>
          </div>
        </OcrCard>
      )}

      {/* ── STEP 4: Confirm ── */}
      {step === 4 && (
        <OcrCard>
          <StepIndicator step={4} total={4} />

          {saved ? (
            // Success state
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
              <CheckCircle2 size={48} style={{ color: '#16A34A' }} aria-hidden="true" />
              <div>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--eq-ink, #1A1A2E)' }}>
                  Licence saved
                </h1>
                <p style={{ margin: '8px 0 0', color: '#6B7280', fontSize: 15 }}>
                  The details have been added to your profile.
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
                <Button onClick={resetFlow}>
                  Add another
                </Button>
                <Button variant="ghost" onClick={() => navigate(`/${tenantSlug ?? ''}`)}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--eq-ink, #1A1A2E)' }}>
                  Ready to save?
                </h1>
              </div>

              {/* Read-only summary */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {fields.document_type && (
                  <ReadOnlyField label="Document type" value={kindLabel(fields.document_type)} />
                )}
                <ReadOnlyField label="Licence / certificate number" value={fields.licence_number} />
                {fields.licence_class && (
                  <ReadOnlyField label="Licence class" value={fields.licence_class} />
                )}
                <ReadOnlyField label="Expiry date" value={fields.expiry_date} />
                {fields.issuing_authority && (
                  <ReadOnlyField label="Issuing authority" value={fields.issuing_authority} />
                )}
                {fields.full_name && (
                  <ReadOnlyField label="Full name" value={fields.full_name} />
                )}
                {fields.date_of_birth && (
                  <ReadOnlyField label="Date of birth" value={fields.date_of_birth} />
                )}
              </div>

              {saveError && (
                <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <p style={{ margin: 0, fontSize: 13, color: '#DC2626' }}>
                    Couldn't save the licence. Your information isn't lost — try again.
                  </p>
                  <Button onClick={() => setConfirmOpen(true)}>
                    Retry
                  </Button>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {!saveError && (
                  <Button onClick={() => setConfirmOpen(true)}>
                    Save licence
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setStep(3)}>
                  Go back and edit
                </Button>
              </div>

              <ConfirmDialog
                open={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={() => void handleSave()}
                title="Save this licence?"
                description="The details will be added to your profile."
                confirmLabel="Save"
                destructive={false}
                loading={saving}
              />
            </>
          )}
        </OcrCard>
      )}

      {/* Pulse animation for ScanLine icon */}
      <style>{`
        @keyframes eq-ocr-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes eq-ocr-pulse {
            0%, 100% { opacity: 1; }
          }
        }
      `}</style>
    </OcrLayout>
  );
}

// ---------------------------------------------------------------------------
// Document type select — separate component to keep JSX readable
// ---------------------------------------------------------------------------

interface DocumentTypeSelectProps {
  value: string;
  onChange: (v: string) => void;
  error?: string;
}

function DocumentTypeSelect({ value, onChange, error }: DocumentTypeSelectProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="eq-field">
      <label className="eq-field__label" htmlFor={id}>
        Document type
      </label>
      <select
        id={id}
        className={`eq-field__input${error ? ' eq-field__input--error' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        style={{ cursor: 'pointer' }}
      >
        <option value="">Select type…</option>
        {LICENCE_KINDS.map((k) => (
          <option key={k.value} value={k.value}>{k.label}</option>
        ))}
      </select>
      {error && (
        <span id={errorId} className="eq-field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
