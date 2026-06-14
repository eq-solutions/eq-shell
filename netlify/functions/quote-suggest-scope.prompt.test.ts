import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScopePrompt } from './quote-suggest-scope.prompt.ts';

test('includes customer, site, project header when provided', () => {
  const p = buildScopePrompt({ customer_name: 'Equinix', site: 'SY6', project_name: 'UPS upgrade' });
  assert.match(p, /Customer: Equinix/);
  assert.match(p, /Site: SY6/);
  assert.match(p, /Project: UPS upgrade/);
});

test('includes the brief and always ends with the tool instruction', () => {
  const p = buildScopePrompt({ brief: 'replace two GPOs in comms room' });
  assert.match(p, /Estimator's brief/);
  assert.match(p, /replace two GPOs in comms room/);
  assert.match(p, /submit_quote_scope tool\.$/);
});

test('lists non-empty line items and skips blanks', () => {
  const p = buildScopePrompt({ line_items: ['Supply & install 2x GPO', '  ', 'Test & tag'] });
  assert.match(p, /- Supply & install 2x GPO/);
  assert.match(p, /- Test & tag/);
  assert.doesNotMatch(p, /- {2,}$/m); // no blank bullet
});

test('does not duplicate existing_scope when it equals the brief', () => {
  const same = 'replace GPOs in comms room';
  const p = buildScopePrompt({ brief: same, existing_scope: same });
  assert.equal(p.match(/replace GPOs in comms room/g)?.length, 1);
});

test('includes existing_scope as a separate block when it differs from the brief', () => {
  const p = buildScopePrompt({ brief: 'new note', existing_scope: 'older draft text' });
  assert.match(p, /improve and expand it/);
  assert.match(p, /older draft text/);
});

test('omits empty sections (no header, no brief) but still asks for the draft', () => {
  const p = buildScopePrompt({});
  assert.doesNotMatch(p, /Customer:/);
  assert.doesNotMatch(p, /Estimator's brief/);
  assert.match(p, /Draft the scope of works now/);
});
