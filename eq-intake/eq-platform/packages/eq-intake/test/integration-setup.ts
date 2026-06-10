/**
 * vitest integration setup — loads eq-platform/.env into process.env
 * before any integration test file runs.
 *
 * Why not just `process.loadEnvFile`? Node's built-in helper refuses to
 * overwrite vars that already exist in the environment — and on Windows
 * shells, `ANTHROPIC_API_KEY` is often pre-set to an empty string from a
 * stale config. That makes the .env value invisible. We hand-parse and
 * write through with override semantics so the .env is always the source
 * of truth for integration tests.
 */
import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ENV_PATH = join(dirname(__filename), "..", "..", "..", ".env");

if (existsSync(ENV_PATH)) {
  const content = readFileSync(ENV_PATH, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip matching surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Override blank values; otherwise leave shell-set values intact.
    if (!process.env[key]) process.env[key] = value;
  }
}
