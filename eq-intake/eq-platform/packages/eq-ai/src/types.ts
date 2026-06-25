/**
 * @eq/ai — types for vendor-agnostic AI provider interface.
 *
 * Implementations: AnthropicProvider (v1). Future: GeminiProvider, LocalProvider.
 *
 * The shapes here mirror the JSON output specs in the prompt templates exactly.
 * If the prompts change, these types change.
 */

// ============================================================================
// MAP — column-to-canonical-field mapping
// ============================================================================

export interface MapInput {
  /** Full canonical JSON Schema for the target entity */
  targetSchema: Record<string, unknown>;
  /** Column headers detected in the source */
  sourceColumns: string[];
  /** 5-20 sample rows. Object form keyed by source column. */
  sampleRows: Record<string, unknown>[];
  /** Previously-confirmed mappings for this tenant + entity. Optional. */
  priorMappings?: Array<{
    sourceName: string;
    columnMap: Record<string, string | null>;
    successRate: number;
  }>;
  /** Free-text user hint (e.g. "this is from MYOB") */
  contextHints?: string;
}

export interface ColumnMapping {
  sourceColumn: string;
  canonicalField: string | null;
  /** 0.0 - 1.0 */
  confidence: number;
  reason: string;
}

export type MappingWarningType =
  | 'ambiguous'
  | 'low_confidence'
  | 'type_mismatch'
  | 'duplicate_target'
  | 'data_anomaly'
  | 'header_quality';

export interface MappingWarning {
  type: MappingWarningType;
  message: string;
  affected: string[];
}

export type MappingSuggestionType =
  | 'split_column'
  | 'concat_columns'
  | 'derive_field'
  | 'apply_transform';

export interface MappingSuggestion {
  type: MappingSuggestionType;
  message: string;
  details: Record<string, unknown>;
}

export interface MappingClarification {
  question: string;
  sourceColumn: string;
  options: string[];
}

export interface MapResult {
  mappings: ColumnMapping[];
  unmappedRequiredFields: string[];
  warnings: MappingWarning[];
  suggestions: MappingSuggestion[];
  needsClarification: MappingClarification[];
  /** Metrics for cost / observability */
  metrics: AIMetrics;
}

// ============================================================================
// EXTRACT — vision extraction from photo / PDF / scan
// ============================================================================

export interface ExtractInput {
  /** Canonical JSON Schema for the target entity */
  targetSchema: Record<string, unknown>;
  /** Hint from the user about what this document is */
  documentTypeHint?: string;
  /** The file as a base64 string */
  fileBase64: string;
  /** MIME type, e.g. 'image/jpeg', 'application/pdf' */
  mediaType: string;
}

export type ExtractWarningType =
  | 'wrong_document_type'
  | 'low_image_quality'
  | 'partial_document'
  | 'foreign_language'
  | 'suspicious_content';

export interface ExtractWarning {
  type: ExtractWarningType;
  message: string;
}

export interface ExtractMetadata {
  estimatedPages: number;
  estimatedCaptureMethod: 'photo' | 'scan' | 'digital_pdf' | 'unknown';
  appearsSigned: boolean;
  appearsComplete: boolean;
}

export interface UncertainField {
  field: string;
  valueCandidates: string[];
  reason: string;
}

export interface ExtractResult {
  /** Canonical fields extracted from the document */
  extracted: Record<string, unknown>;
  /** Per-field confidence 0.0-1.0 */
  fieldConfidence: Record<string, number>;
  /** All readable text from the document, in reading order. Mandatory audit anchor. */
  rawText: string;
  uncertainFields: UncertainField[];
  illegibleRegions: string[];
  warnings: ExtractWarning[];
  metadata: ExtractMetadata;
  /** Metrics for cost / observability */
  metrics: AIMetrics;
}

// ============================================================================
// ENRICH — infer missing field values from the values a row already has
// ============================================================================

export interface EnrichRowInput {
  /** Source row index — echoed back so the caller can match suggestions to rows. */
  index: number;
  /**
   * The values this row already has (e.g. { name, make, model }). The model
   * infers the requested fields from these. Keys are canonical field names.
   */
  fields: Record<string, unknown>;
}

export interface EnrichInput {
  /** Canonical JSON Schema for the target entity (supplies allowed enum/suggested values). */
  targetSchema: Record<string, unknown>;
  /** Rows to enrich, each carrying the values already known for that row. */
  rows: EnrichRowInput[];
  /** Canonical field names to infer (e.g. ['asset_type','criticality','ppm_frequency']). */
  fieldsToInfer: string[];
}

export interface FieldSuggestion {
  /** Suggested value, or null when the model declined to guess. */
  value: unknown;
  /** 0.0 - 1.0 */
  confidence: number;
  reason: string;
}

export interface EnrichRowSuggestion {
  index: number;
  /** Per-field suggestions. Fields the model declined are omitted or have value null. */
  fields: Record<string, FieldSuggestion>;
}

export interface EnrichResult {
  suggestions: EnrichRowSuggestion[];
  metrics: AIMetrics;
}

// ============================================================================
// METRICS — captured for every call, fed to telemetry by caller
// ============================================================================

export interface AIMetrics {
  /** Provider name e.g. 'anthropic' */
  provider: string;
  /** Model used e.g. 'claude-sonnet-4-5' */
  model: string;
  /** Input tokens */
  tokensIn: number;
  /** Output tokens */
  tokensOut: number;
  /** Total latency end-to-end in ms */
  latencyMs: number;
  /** Whether the call succeeded (returned valid result) */
  success: boolean;
  /** If success=false, the error category */
  errorCode?: AIErrorCode;
  /** Whether the response was retried */
  retried: boolean;
  /** Wall-clock time of the call start (ISO) */
  startedAt: string;
}

export type AIErrorCode =
  | 'timeout'
  | 'rate_limited'
  | 'invalid_response_json'
  | 'response_schema_mismatch'
  | 'auth_failed'
  | 'service_unavailable'
  | 'unknown';

// ============================================================================
// PROVIDER INTERFACE
// ============================================================================

export interface AIProvider {
  map(input: MapInput): Promise<MapResult>;
  extract(input: ExtractInput): Promise<ExtractResult>;
  /**
   * Infer missing field values from the values a row already has. Optional —
   * a provider (or a test mock) that doesn't implement it simply disables the
   * enrichment step; callers must guard on its presence.
   */
  enrich?(input: EnrichInput): Promise<EnrichResult>;
}

/**
 * Optional metrics callback. If supplied, every call invokes it with the
 * AIMetrics. Use for telemetry to Supabase, OpenTelemetry, or stdout logging.
 */
export type MetricsCallback = (m: AIMetrics) => void | Promise<void>;
