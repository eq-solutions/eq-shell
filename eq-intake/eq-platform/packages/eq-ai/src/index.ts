/**
 * @eq/ai — vendor-agnostic AI provider for EQ Solves
 *
 * Drop into apps via:
 *   import { AnthropicProvider, type AIProvider } from '@eq/ai';
 *
 *   const ai: AIProvider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
 *   const result = await ai.map({ targetSchema, sourceColumns, sampleRows });
 *
 * The AIProvider interface is the swap point. Future implementations:
 *   - GeminiProvider (when cost or feature-set warrants comparison)
 *   - LocalProvider (for tenants with data-residency constraints)
 *   - MockProvider (for tests, returns canned responses)
 */

export type {
  AIProvider,
  AIMetrics,
  AIErrorCode,
  MetricsCallback,
  // Map types
  MapInput,
  MapResult,
  ColumnMapping,
  MappingWarning,
  MappingWarningType,
  MappingSuggestion,
  MappingSuggestionType,
  MappingClarification,
  // Extract types
  ExtractInput,
  ExtractResult,
  ExtractWarning,
  ExtractWarningType,
  ExtractMetadata,
  UncertainField,
} from './types';

export { AnthropicProvider, AIError } from './anthropic';
export type { AnthropicProviderOptions } from './anthropic';
