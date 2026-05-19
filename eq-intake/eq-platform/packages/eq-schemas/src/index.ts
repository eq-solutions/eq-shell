/**
 * @eq/schemas — public API.
 *
 * Re-exports every generated TypeScript type and Zod validator from
 * `src/generated/`. Schemas live as JSON in `src/schemas/` and are the single
 * source of truth (Sprint 1, decision #1). Generated artifacts are produced
 * by `pnpm generate` (json-schema-to-typescript + json-schema-to-zod).
 *
 * If `src/generated/` is missing, run `pnpm generate` (or `pnpm install` —
 * the prepare hook regenerates).
 */

export * from "./generated/index.js";
