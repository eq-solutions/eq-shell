/**
 * The three role buckets a SimPRO-shaped intake gets classified into:
 * customer records, contact records, site records. Used by the dropzone,
 * the template engine, and tests to key role-indexed maps.
 */

export type RoleName = "customer" | "contact" | "site";
