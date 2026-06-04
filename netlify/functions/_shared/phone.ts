// Shared AU mobile normaliser → E.164 (+61XXXXXXXXX).
//
// Single source for the server side so the invite/accept path and the
// phone-OTP login door agree on what a phone number looks like. Supabase
// stores phones in E.164; users.phone is UNIQUE (where not null), so a
// consistent canonical form is what keeps "one human = one row" honest.
//
// Returns null when the input isn't a recognisable AU mobile — callers
// reject (invite) or treat as "no phone" rather than storing junk.

export function normalizeAuPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+61') && digits.length === 11) return trimmed;
  if (digits.startsWith('61') && digits.length === 11) return '+' + digits;
  if (digits.startsWith('0') && digits.length === 10) return '+61' + digits.slice(1);
  if (digits.length === 9 && digits.startsWith('4')) return '+61' + digits;
  return null;
}
