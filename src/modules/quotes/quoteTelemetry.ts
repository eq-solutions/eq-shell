import * as Sentry from "@sentry/react";

// Report a failed EQ Ops quote/pricing RPC to Sentry so failures surface instead of
// only showing the user an inline message. Matches the repo convention of tagging by
// `surface`. No-op when there is no error, so it's safe to call on every result.
export function captureRpcError(
  rpc: string,
  error: { message?: string; code?: string; details?: string } | null | undefined,
  extra?: Record<string, unknown>,
): void {
  if (!error) return;
  Sentry.captureException(
    new Error(`eq-ops rpc ${rpc} failed: ${error.message ?? "unknown error"}`),
    {
      tags: { surface: "eq-ops-quotes", rpc },
      extra: { code: error.code, details: error.details, ...extra },
    },
  );
}
