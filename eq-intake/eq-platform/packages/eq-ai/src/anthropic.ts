/**
 * @eq/ai — Anthropic provider implementation.
 *
 * Wraps the Anthropic Messages API for the two operations EQ Solves needs:
 *   - map(): column-to-canonical-field mapping
 *   - extract(): vision-based document extraction
 *
 * Loads system prompts from src/prompts/ at construction time.
 * Handles JSON parsing (with markdown fence stripping), retries on transient
 * failures, and metrics capture.
 */

import type {
  AIProvider,
  MapInput,
  MapResult,
  ExtractInput,
  ExtractResult,
  AIMetrics,
  MetricsCallback,
  AIErrorCode,
} from './types';

// ============================================================================
// CONFIG
// ============================================================================

export interface AnthropicProviderOptions {
  /** API key. If omitted, reads from ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  /** Default model for map() */
  mapModel?: string;
  /** Default model for extract() (typical case) */
  extractModel?: string;
  /** Escalation model for extract() when confidence is low */
  extractEscalationModel?: string;
  /** Confidence threshold below which to escalate from Sonnet → Opus on extract */
  escalationThreshold?: number;
  /** Request timeout in ms */
  timeoutMs?: number;
  /** Max retries on transient failures */
  maxRetries?: number;
  /** Optional metrics callback */
  onMetrics?: MetricsCallback;
  /** Override base URL (for proxies) */
  baseUrl?: string;
}

const DEFAULTS: Required<Omit<AnthropicProviderOptions, 'apiKey' | 'onMetrics'>> = {
  mapModel: 'claude-sonnet-4-5',
  extractModel: 'claude-sonnet-4-5',
  extractEscalationModel: 'claude-opus-4-7',
  escalationThreshold: 0.6,
  timeoutMs: 30_000,
  maxRetries: 2,
  baseUrl: 'https://api.anthropic.com/v1',
};

const ANTHROPIC_VERSION = '2023-06-01';

// ============================================================================
// PROMPTS — loaded inline as strings (built into the package at compile time)
// ============================================================================
// In a real build, the prompts/*.md files are loaded at package build time
// via a small build script that converts MD → TS string export. For now we
// reference them by filename and the consumer can replace with bundled content.

import { COLUMN_MAPPING_SYSTEM_PROMPT } from './prompts/column-mapping';
import { VISION_EXTRACTION_SYSTEM_PROMPT } from './prompts/vision-extraction';

// ============================================================================
// PROVIDER
// ============================================================================

export class AnthropicProvider implements AIProvider {
  private opts: Required<Omit<AnthropicProviderOptions, 'apiKey' | 'onMetrics'>> & {
    apiKey: string;
    onMetrics?: MetricsCallback;
  };

  constructor(options: AnthropicProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('AnthropicProvider: apiKey is required (pass directly or set ANTHROPIC_API_KEY env var)');
    }
    this.opts = {
      ...DEFAULTS,
      ...options,
      apiKey,
    };
  }

  // --------------------------------------------------------------------------
  // map() — column mapping
  // --------------------------------------------------------------------------

  async map(input: MapInput): Promise<MapResult> {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();

    const userPrompt = this.buildMapUserPrompt(input);
    const model = this.opts.mapModel;

    let lastError: AIErrorCode | undefined;
    let retried = false;

    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      try {
        const response = await this.callMessages({
          model,
          system: COLUMN_MAPPING_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
          maxTokens: 4096,
          temperature: 0.0,
        });

        const parsed = this.parseJsonResponse(response.text);
        const mapResult = this.normalizeMapResult(parsed);

        const metrics: AIMetrics = {
          provider: 'anthropic',
          model,
          tokensIn: response.usage.inputTokens,
          tokensOut: response.usage.outputTokens,
          latencyMs: Date.now() - t0,
          success: true,
          retried,
          startedAt,
        };
        await this.recordMetrics(metrics);

        return { ...mapResult, metrics };
      } catch (e) {
        const code = classifyError(e);
        lastError = code;
        if (!isRetriable(code) || attempt === this.opts.maxRetries) {
          const metrics: AIMetrics = {
            provider: 'anthropic',
            model,
            tokensIn: 0,
            tokensOut: 0,
            latencyMs: Date.now() - t0,
            success: false,
            errorCode: code,
            retried,
            startedAt,
          };
          await this.recordMetrics(metrics);
          throw new AIError(`map() failed: ${code}`, code, e);
        }
        retried = true;
        await sleep(backoffDelay(attempt));
      }
    }

    // Unreachable, but TypeScript doesn't know
    throw new AIError(`map() exhausted retries: ${lastError ?? 'unknown'}`, lastError ?? 'unknown');
  }

  // --------------------------------------------------------------------------
  // extract() — vision extraction
  // --------------------------------------------------------------------------

  async extract(input: ExtractInput): Promise<ExtractResult> {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();

    // First pass with default extract model
    const firstResult = await this.runExtract(input, this.opts.extractModel, startedAt, t0);

    // Check if we should escalate to Opus
    const lowConfidenceCount = Object.values(firstResult.fieldConfidence).filter(
      (c) => c < this.opts.escalationThreshold,
    ).length;
    const totalFields = Object.keys(firstResult.fieldConfidence).length;

    const shouldEscalate =
      totalFields > 0 && lowConfidenceCount / totalFields > 0.5;

    if (!shouldEscalate || this.opts.extractEscalationModel === this.opts.extractModel) {
      return firstResult;
    }

    // Escalate
    try {
      const escalated = await this.runExtract(
        input,
        this.opts.extractEscalationModel,
        startedAt,
        t0,
      );
      return escalated;
    } catch {
      // Fall back to first result if escalation fails — better partial than nothing
      return firstResult;
    }
  }

  private async runExtract(
    input: ExtractInput,
    model: string,
    startedAt: string,
    t0: number,
  ): Promise<ExtractResult> {
    const userPrompt = this.buildExtractUserPrompt(input);

    let retried = false;
    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      try {
        const response = await this.callMessages({
          model,
          system: VISION_EXTRACTION_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: input.mediaType,
                    data: input.fileBase64,
                  },
                },
                { type: 'text', text: userPrompt },
              ],
            },
          ],
          maxTokens: 8192,
          temperature: 0.0,
        });

        const parsed = this.parseJsonResponse(response.text);
        const extractResult = this.normalizeExtractResult(parsed);

        const metrics: AIMetrics = {
          provider: 'anthropic',
          model,
          tokensIn: response.usage.inputTokens,
          tokensOut: response.usage.outputTokens,
          latencyMs: Date.now() - t0,
          success: true,
          retried,
          startedAt,
        };
        await this.recordMetrics(metrics);

        return { ...extractResult, metrics };
      } catch (e) {
        const code = classifyError(e);
        if (!isRetriable(code) || attempt === this.opts.maxRetries) {
          const metrics: AIMetrics = {
            provider: 'anthropic',
            model,
            tokensIn: 0,
            tokensOut: 0,
            latencyMs: Date.now() - t0,
            success: false,
            errorCode: code,
            retried,
            startedAt,
          };
          await this.recordMetrics(metrics);
          throw new AIError(`extract() failed: ${code}`, code, e);
        }
        retried = true;
        await sleep(backoffDelay(attempt));
      }
    }
    throw new AIError('extract() exhausted retries', 'unknown');
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private buildMapUserPrompt(input: MapInput): string {
    return [
      'target_schema:',
      JSON.stringify(input.targetSchema, null, 2),
      '',
      'source_columns:',
      JSON.stringify(input.sourceColumns),
      '',
      'sample_rows:',
      JSON.stringify(input.sampleRows.slice(0, 20), null, 2),
      '',
      'prior_mappings:',
      input.priorMappings ? JSON.stringify(input.priorMappings, null, 2) : 'none',
      '',
      'context_hints:',
      input.contextHints ?? 'none',
    ].join('\n');
  }

  private buildExtractUserPrompt(input: ExtractInput): string {
    return [
      'target_schema:',
      JSON.stringify(input.targetSchema, null, 2),
      '',
      'document_type_hint:',
      input.documentTypeHint ?? 'unknown',
      '',
      'Extract per the system prompt rules. Return only the JSON object.',
    ].join('\n');
  }

  private parseJsonResponse(text: string): unknown {
    // Strip markdown fences if present (model occasionally adds them despite instructions)
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
    }
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      throw new AIError('Response was not valid JSON', 'invalid_response_json', e);
    }
  }

  private normalizeMapResult(raw: any): Omit<MapResult, 'metrics'> {
    if (!raw || typeof raw !== 'object') {
      throw new AIError('map response missing top-level object', 'response_schema_mismatch');
    }
    if (!Array.isArray(raw.mappings)) {
      throw new AIError('map response missing mappings array', 'response_schema_mismatch');
    }
    return {
      mappings: raw.mappings.map((m: any) => ({
        sourceColumn: String(m.source_column ?? m.sourceColumn ?? ''),
        canonicalField: m.canonical_field ?? m.canonicalField ?? null,
        confidence: Number(m.confidence ?? 0),
        reason: String(m.reason ?? ''),
      })),
      unmappedRequiredFields: Array.isArray(raw.unmapped_required_fields)
        ? raw.unmapped_required_fields.map(String)
        : Array.isArray(raw.unmappedRequiredFields)
          ? raw.unmappedRequiredFields.map(String)
          : [],
      warnings: (raw.warnings ?? []).map((w: any) => ({
        type: w.type,
        message: String(w.message ?? ''),
        affected: Array.isArray(w.affected) ? w.affected.map(String) : [],
      })),
      suggestions: (raw.suggestions ?? []).map((s: any) => ({
        type: s.type,
        message: String(s.message ?? ''),
        details: s.details ?? {},
      })),
      needsClarification: (raw.needs_clarification ?? raw.needsClarification ?? []).map((c: any) => ({
        question: String(c.question ?? ''),
        sourceColumn: String(c.source_column ?? c.sourceColumn ?? ''),
        options: Array.isArray(c.options) ? c.options.map(String) : [],
      })),
    };
  }

  private normalizeExtractResult(raw: any): Omit<ExtractResult, 'metrics'> {
    if (!raw || typeof raw !== 'object') {
      throw new AIError('extract response missing top-level object', 'response_schema_mismatch');
    }
    return {
      extracted: raw.extracted ?? {},
      fieldConfidence: raw.field_confidence ?? raw.fieldConfidence ?? {},
      rawText: String(raw.raw_text ?? raw.rawText ?? ''),
      uncertainFields: (raw.uncertain_fields ?? raw.uncertainFields ?? []).map((u: any) => ({
        field: String(u.field ?? ''),
        valueCandidates: Array.isArray(u.value_candidates ?? u.valueCandidates)
          ? (u.value_candidates ?? u.valueCandidates).map(String)
          : [],
        reason: String(u.reason ?? ''),
      })),
      illegibleRegions: Array.isArray(raw.illegible_regions ?? raw.illegibleRegions)
        ? (raw.illegible_regions ?? raw.illegibleRegions).map(String)
        : [],
      warnings: (raw.warnings ?? []).map((w: any) => ({
        type: w.type,
        message: String(w.message ?? ''),
      })),
      metadata: {
        estimatedPages: Number(raw.metadata?.estimated_pages ?? raw.metadata?.estimatedPages ?? 1),
        estimatedCaptureMethod:
          raw.metadata?.estimated_capture_method ??
          raw.metadata?.estimatedCaptureMethod ??
          'unknown',
        appearsSigned: Boolean(raw.metadata?.appears_signed ?? raw.metadata?.appearsSigned),
        appearsComplete: Boolean(raw.metadata?.appears_complete ?? raw.metadata?.appearsComplete),
      },
    };
  }

  private async callMessages(req: {
    model: string;
    system: string;
    messages: any[];
    maxTokens: number;
    temperature: number;
  }): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);

    let resp: Response;
    try {
      resp = await fetch(`${this.opts.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.opts.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: req.model,
          system: req.system,
          messages: req.messages,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const body = await resp.text();
      if (resp.status === 401 || resp.status === 403) {
        throw new AIError(`auth failed: ${resp.status}`, 'auth_failed');
      }
      if (resp.status === 429) {
        throw new AIError(`rate limited: ${body}`, 'rate_limited');
      }
      if (resp.status >= 500) {
        throw new AIError(`service unavailable: ${resp.status}`, 'service_unavailable');
      }
      throw new AIError(`unexpected status ${resp.status}: ${body}`, 'unknown');
    }

    const data: any = await resp.json();
    const textBlocks = (data.content ?? []).filter((b: any) => b.type === 'text');
    if (textBlocks.length === 0) {
      throw new AIError('no text content in response', 'response_schema_mismatch');
    }
    return {
      text: textBlocks.map((b: any) => b.text).join(''),
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
    };
  }

  private async recordMetrics(m: AIMetrics): Promise<void> {
    if (this.opts.onMetrics) {
      try {
        await this.opts.onMetrics(m);
      } catch {
        // Metrics callbacks must never break the main path.
      }
    }
  }
}

// ============================================================================
// HELPERS
// ============================================================================

export class AIError extends Error {
  constructor(
    message: string,
    public readonly code: AIErrorCode,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AIError';
  }
}

function classifyError(e: unknown): AIErrorCode {
  if (e instanceof AIError) return e.code;
  if (e instanceof Error) {
    if (e.name === 'AbortError') return 'timeout';
    return 'unknown';
  }
  return 'unknown';
}

function isRetriable(code: AIErrorCode): boolean {
  return code === 'timeout' || code === 'rate_limited' || code === 'service_unavailable';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffDelay(attempt: number): number {
  // Exponential backoff with jitter: 1s, 2s, 4s ± 25%
  const base = 1000 * Math.pow(2, attempt);
  const jitter = base * (Math.random() * 0.5 - 0.25);
  return Math.floor(base + jitter);
}
