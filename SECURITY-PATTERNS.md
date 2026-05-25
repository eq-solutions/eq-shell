# EQ Security Patterns

These standards apply to every app in the EQ suite. When starting a new
app or adding a new endpoint, check each pattern before shipping.

## 1. Secret initialisation — fail loudly

Never default secrets to empty string. Missing env var = crash, not silent failure.

```ts
// WRONG
const SECRET = process.env.MY_SECRET ?? '';

// RIGHT — guard inside the function that uses it
function sign(input: string): string {
  const secret = process.env.MY_SECRET;
  if (!secret) throw new Error('MY_SECRET not set — check Netlify env vars');
  return createHmac('sha256', secret).update(input).digest('hex');
}
```

## 2. Rate limiting — fail closed

If the rate-limit RPC fails, block the request. Never allow on failure.

```ts
const { data, error } = await sb.rpc('check_and_increment_rate_limit', { p_key });
if (error) return response(503, { error: 'service-unavailable' }); // block
```

Reference implementation: eq-solves-field `verify-pin.js` (distributed RPC + in-memory fallback).

## 3. Token verification checklist

Every HMAC token must check all four before trusting:

- [ ] **Signature** — `timingSafeEqual()`, never `===`
- [ ] **Expiry** — `data.exp < Date.now()`
- [ ] **Kind** — `data.kind === 'expected-token-type'` (prevents token confusion)
- [ ] **Tenant** — `data.tenant_slug` matches this deployment's slug

## 4. bcrypt work factor

Minimum 12 rounds for all PIN and password hashing. 10 is insufficient.

```ts
const hash = await bcrypt.hash(input, 12); // not 10
```

## 5. Error responses — no state leakage

Never return different codes or messages for "not found" vs "wrong credential" vs "inactive". All invalid-auth paths return the same response.

```ts
return response(400, { error: 'invalid-credentials' }); // always the same
```

## 6. Security headers — netlify.toml block

Copy this into every new EQ repo's `netlify.toml`. Adjust `frame-src` and `connect-src` per app. Reference: `eq-shell/netlify.toml` for the canonical version.

```toml
[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "camera=(), microphone=(), geolocation=()"
    Strict-Transport-Security = "max-age=31536000; includeSubDomains; preload"
    Content-Security-Policy = "default-src 'self'; ..."
```

Deploy in Report-Only mode first (`Content-Security-Policy-Report-Only`), promote to enforce after 24h with no violations in Netlify logs.

## 7. Tenant scope on service-to-service calls

A bearer key authenticates the **app**, not the tenant. Always validate both:

1. Key authenticates the calling app
2. That app is in scope for the requested tenant

Never allow an app key to access arbitrary tenants without an explicit allow-list. Reference: `eq-shell/netlify/functions/canonical-api.ts` — `APP_TENANT_SCOPE`.

## 8. Input validation

- All params validated before any DB touch
- Enums: check against explicit `Set`/union, not freeform strings
- Limits/offsets: clamp to sane ranges (`limit = Math.min(requested, 200)`)
- UUIDs: validate format before use in queries
- Server actions in Next.js: Zod schema on every mutation (see `eq-solves-service`)

## 9. EQ_SECRET_SALT — shared key rules

- All four apps (Shell, Field, Cards, Service) must hold identical value
- Rotation must happen on all four Netlify deploys simultaneously
- Document in every repo's `.env.example` with a comment, never the real value
- If any deploy is missing it, Shell SSO silently breaks for that app

## 10. CSP lifecycle

1. Write the policy
2. Deploy as `Content-Security-Policy-Report-Only`
3. Wait 24h, review Netlify logs for violations
4. Fix any legitimate blocked sources
5. Promote to `Content-Security-Policy` (enforce)
