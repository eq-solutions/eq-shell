/**
 * vitest integration setup - loads eq-platform/.env into process.env
 * before any test file runs. Uses Node\'s built-in loadEnvFile (Node
 * 20.12+) so no dotenv dependency is needed and the same script works
 * on Windows / macOS / Linux without CLI flag gymnastics.
 */

import process from "node:process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ENV_PATH = join(dirname(__filename), "..", "..", "..", ".env");

if (existsSync(ENV_PATH) && typeof (process as { loadEnvFile?: (p: string) => void }).loadEnvFile === "function") {
  (process as { loadEnvFile: (p: string) => void }).loadEnvFile(ENV_PATH);
}
