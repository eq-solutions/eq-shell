/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential. All rights reserved.
 *
 * DEPRECATED 2026-04-26 — the link-based reset flow is gone. The only path
 * to set a password during recovery is now `verifyRecoveryOtpAction`
 * exported from `../forgot-password/actions` (typed code + new password
 * in one shot). Re-exported under the old name so any direct callers in
 * the codebase keep compiling while the migration completes.
 */
export { verifyRecoveryOtpAction as resetPasswordAction } from '../forgot-password/actions'
