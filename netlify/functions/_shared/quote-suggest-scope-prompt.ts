// Pure prompt-building for quote-suggest-scope. Kept separate from the handler so
// it can be unit-tested without importing the auth/sentry/supabase stack.

export interface ScopeInput {
  customer_name?: string;
  project_name?: string;
  site?: string;
  brief?: string;
  line_items?: string[];
  existing_scope?: string;
}

/** Build the user message sent to Claude from the create-form context. */
export function buildScopePrompt(input: ScopeInput): string {
  const lines: string[] = [];
  const header: string[] = [];
  if (input.customer_name?.trim()) header.push(`Customer: ${input.customer_name.trim()}`);
  if (input.site?.trim()) header.push(`Site: ${input.site.trim()}`);
  if (input.project_name?.trim()) header.push(`Project: ${input.project_name.trim()}`);
  if (header.length > 0) { lines.push(...header, ''); }

  if (input.brief?.trim()) {
    lines.push("Estimator's brief (expand this into a full scope):", input.brief.trim(), '');
  }

  const items = (input.line_items ?? []).map((s) => s.trim()).filter(Boolean);
  if (items.length > 0) {
    lines.push('Line items already on the quote (these define the work to be scoped):');
    for (const it of items) lines.push(`- ${it}`);
    lines.push('');
  }

  if (input.existing_scope?.trim() && input.existing_scope.trim() !== input.brief?.trim()) {
    lines.push('There is an existing draft scope — improve and expand it rather than starting over:', input.existing_scope.trim(), '');
  }

  lines.push('Draft the scope of works now using the submit_quote_scope tool.');
  return lines.join('\n');
}
