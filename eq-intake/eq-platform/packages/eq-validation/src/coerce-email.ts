/**
 * @eq/validation — email coercer
 *
 * Normalises email addresses and catches common transcription typos.
 *
 * What it fixes automatically (transformed: true):
 *   - Uppercase → lowercase
 *   - Leading/trailing whitespace stripped
 *   - Common TLD typos: .xom → .com, .cmo → .com, .nte → .net, .ogr → .org
 *   - Common domain typos: gmial → gmail, yahooo → yahoo, homail → hotmail,
 *     outlokk → outlook, livve → live
 *
 * What it flags as invalid (err):
 *   - No @ sign
 *   - Nothing before or after @
 *   - Domain has no dot
 *   - Consecutive dots
 *
 * What it does NOT do:
 *   - MX record lookups (no I/O — coercers are pure)
 *   - Full RFC 5322 validation (too strict for real-world data)
 *   - Guess missing TLDs
 *
 * Contract:
 *   - Null / undefined / empty → ok('', false) — email is optional on most entities
 *   - Invalid format → err('email_invalid')
 *   - Valid and unchanged → ok(email, false)
 *   - Valid and normalised → ok(email, true)
 */

import { CoerceOptions, CoerceResult, ok, err } from './types';

const TLD_TYPOS: Record<string, string> = {
  '.xom': '.com',
  '.cmo': '.com',
  '.ocm': '.com',
  '.con': '.com',
  '.nte': '.net',
  '.ent': '.net',
  '.ogr': '.org',
  '.rog': '.org',
  '.gvo': '.gov',
  '.ovg': '.gov',
  '.ua':  '.au',   // .com.au mistype shorthand
};

const DOMAIN_TYPOS: Record<string, string> = {
  'gmial':   'gmail',
  'gmai':    'gmail',
  'gmal':    'gmail',
  'yahooo':  'yahoo',
  'yaho':    'yahoo',
  'homail':  'hotmail',
  'hotmai':  'hotmail',
  'hotmali': 'hotmail',
  'outlokk': 'outlook',
  'outlok':  'outlook',
  'livve':   'live',
  'icolud':  'icloud',
  'iclould': 'icloud',
};

function fixDomain(domain: string): string {
  // Split on first dot to isolate the domain name from TLD
  const dotIdx = domain.indexOf('.');
  if (dotIdx === -1) return domain;

  const name = domain.slice(0, dotIdx);
  const tld  = domain.slice(dotIdx);

  const fixedName = DOMAIN_TYPOS[name] ?? name;
  const fixedTld  = TLD_TYPOS[tld]  ?? tld;

  return fixedName + fixedTld;
}

export function coerceEmail(
  value: unknown,
  opts: Partial<CoerceOptions> = {},
): CoerceResult<string> {
  if (value === null || value === undefined || value === '') {
    if (opts.strict) return err('value_null_or_empty', 'Email is required.');
    return ok('', false);
  }

  const raw = String(value).trim();
  if (raw === '') {
    if (opts.strict) return err('value_null_or_empty', 'Email is required.');
    return ok('', false);
  }

  // Basic structural check before normalising
  const atIdx = raw.indexOf('@');
  if (atIdx === -1) {
    return err('email_invalid', `"${raw}" is not a valid email — missing @.`);
  }

  const localPart = raw.slice(0, atIdx);
  const domainPart = raw.slice(atIdx + 1);

  if (!localPart) {
    return err('email_invalid', `"${raw}" is not a valid email — nothing before @.`);
  }
  if (!domainPart) {
    return err('email_invalid', `"${raw}" is not a valid email — nothing after @.`);
  }
  if (!domainPart.includes('.')) {
    return err('email_invalid', `"${raw}" is not a valid email — domain has no dot.`);
  }
  if (/\.{2,}/.test(raw)) {
    return err('email_invalid', `"${raw}" is not a valid email — consecutive dots.`);
  }

  // Normalise: lowercase the whole address, then fix domain typos
  const lowered = raw.toLowerCase();
  const [lowLocal, lowDomain] = lowered.split('@') as [string, string];
  const fixedDomain = fixDomain(lowDomain);
  const canonical = `${lowLocal}@${fixedDomain}`;

  const transformed = canonical !== raw;

  return ok(canonical, transformed);
}
