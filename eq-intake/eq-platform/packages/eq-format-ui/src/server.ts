/**
 * Vite plugin: API middleware for /api/ai/map and /api/validate.
 *
 * Runs in the dev server. Reads ANTHROPIC_API_KEY from eq-platform/.env
 * via Node\'s built-in process.loadEnvFile (Node 20.12+, no dotenv dep).
 *
 * Demo-grade only: handlers throw raw errors back to the client. Real
 * deployment would need a proper backend with auth, rate limiting,
 * structured logging.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import type { Plugin } from "vite";

import { AnthropicProvider, type MapInput } from "@eq/ai";
import { validate, type ValidateOpts, computeSignatureHash } from "@eq/validation";
import { derive, listProfiles, getProfile, encodeCsv } from "./derive";
import { mkdir, readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const PKG_ROOT = join(dirname(__filename), "..");
const ENV_PATH = join(PKG_ROOT, "..", "..", ".env");
const SCHEMAS_DIR = join(PKG_ROOT, "..", "eq-schemas", "src", "schemas");
const TEMPLATES_DIR = join(PKG_ROOT, ".templates");

let envLoaded = false;
function loadEnvOnce() {
  if (envLoaded) return;
  if (existsSync(ENV_PATH) && typeof (process as { loadEnvFile?: (p: string) => void }).loadEnvFile === "function") {
    (process as { loadEnvFile: (p: string) => void }).loadEnvFile(ENV_PATH);
  }
  envLoaded = true;
}

async function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function loadSchema(entity: string): Record<string, unknown> {
  const path = join(SCHEMAS_DIR, `${entity}.schema.json`);
  if (!existsSync(path)) {
    throw new Error(`Unknown entity \"${entity}\" (no schema at ${path})`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function apiPlugin(): Plugin {
  return {
    name: "eq-format-api",
    configureServer(server) {
      loadEnvOnce();

      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith("/api/")) return next();

        try {
          // GET /api/entities -> list of available canonical entities
          if (req.method === "GET" && req.url === "/api/entities") {
            const fs = await import("node:fs/promises");
            const all = await fs.readdir(SCHEMAS_DIR);
            const entities = all
              .filter((f) => f.endsWith(".schema.json"))
              .map((f) => f.replace(/\.schema\.json$/, ""))
              .sort();
            return sendJson(res, 200, { entities });
          }

          // GET /api/schema/:entity -> the JSON schema
          const schemaMatch = /^\/api\/schema\/([\w-]+)$/.exec(req.url);
          if (req.method === "GET" && schemaMatch) {
            const schema = loadSchema(schemaMatch[1]!);
            return sendJson(res, 200, schema);
          }

          // POST /api/ai/map
          if (req.method === "POST" && req.url === "/api/ai/map") {
            if (!process.env.ANTHROPIC_API_KEY) {
              return sendJson(res, 503, {
                error: "ANTHROPIC_API_KEY not set",
                hint: "Add it to eq-platform/.env and restart the dev server",
              });
            }
            const body = (await readJson(req)) as {
              entity: string;
              sourceColumns: string[];
              sampleRows: Record<string, unknown>[];
            };
            const targetSchema = loadSchema(body.entity);
            const ai = new AnthropicProvider({});
            const input: MapInput = {
              targetSchema,
              sourceColumns: body.sourceColumns,
              sampleRows: body.sampleRows,
            };
            const result = await ai.map(input);
            return sendJson(res, 200, result);
          }

          // POST /api/validate
          if (req.method === "POST" && req.url === "/api/validate") {
            const body = (await readJson(req)) as {
              entity: string;
              mapping: Record<string, string | null>;
              rows: Record<string, unknown>[];
            };
            const schema = loadSchema(body.entity);
            const opts: ValidateOpts = {
              schema,
              mapping: body.mapping,
              rows: body.rows,
              tenantId: "00000000-0000-4000-8000-000000000001", // demo tenant
              locale: "en-AU",
            };
            const result = await validate(opts);
            return sendJson(res, 200, result);
          }

          // GET /api/format/profiles -> list of registered derive profiles
          if (req.method === "GET" && req.url === "/api/format/profiles") {
            const summary = listProfiles().map((p) => ({
              id: p.id,
              label: p.label,
              description: p.description,
              inputShape: p.inputShape,
            }));
            return sendJson(res, 200, { profiles: summary });
          }

          // POST /api/format/derive
          //   body: { profile: string; rows: Record<string,unknown>[] }
          //   response: text/csv if rows non-empty; 404 if unknown profile.
          if (req.method === "POST" && req.url === "/api/format/derive") {
            const body = (await readJson(req)) as {
              profile: string;
              rows: Record<string, unknown>[];
            };
            if (!body.profile || !Array.isArray(body.rows)) {
              return sendJson(res, 400, {
                error: "body must include { profile: string, rows: Record<string,unknown>[] }",
              });
            }
            if (!getProfile(body.profile)) {
              return sendJson(res, 404, {
                error: `Unknown derive profile: ${body.profile}`,
                available: listProfiles().map((p) => p.id),
              });
            }
            const result = derive(body.profile, body.rows);
            const csv = encodeCsv(result.columns, result.rows);
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename=\"${body.profile}.csv\"`);
            res.end(csv);
            return;
          }

          // POST /api/templates/find -> mapping if a previously-saved template
          //   matches the signature of (entity, columns, sampleRows).
          // Body: { entity, columns, sampleRows }
          // Response: 200 { hit: true, mapping } or 200 { hit: false }
          if (req.method === "POST" && req.url === "/api/templates/find") {
            const body = (await readJson(req)) as {
              entity: string;
              columns: string[];
              sampleRows: Record<string, unknown>[];
            };
            const hash = await computeSignatureHash({
              entity: body.entity,
              columns: body.columns,
              sampleRows: body.sampleRows,
            });
            const path = join(TEMPLATES_DIR, `${hash}.json`);
            if (!existsSync(path)) {
              return sendJson(res, 200, { hit: false, hash });
            }
            const raw = await fsReadFile(path, "utf8");
            const saved = JSON.parse(raw) as { entity: string; mapping: Record<string, string | null>; savedAt: string };
            return sendJson(res, 200, { hit: true, hash, ...saved });
          }

          // POST /api/templates/save -> persist a mapping keyed by the signature.
          // Body: { entity, columns, sampleRows, mapping }
          // Response: 200 { hash, savedAt }
          if (req.method === "POST" && req.url === "/api/templates/save") {
            const body = (await readJson(req)) as {
              entity: string;
              columns: string[];
              sampleRows: Record<string, unknown>[];
              mapping: Record<string, string | null>;
            };
            const hash = await computeSignatureHash({
              entity: body.entity,
              columns: body.columns,
              sampleRows: body.sampleRows,
            });
            await mkdir(TEMPLATES_DIR, { recursive: true });
            const savedAt = new Date().toISOString();
            const payload = { entity: body.entity, mapping: body.mapping, savedAt };
            await fsWriteFile(join(TEMPLATES_DIR, `${hash}.json`), JSON.stringify(payload, null, 2), "utf8");
            return sendJson(res, 200, { hash, savedAt });
          }

          return sendJson(res, 404, { error: `No route for ${req.method} ${req.url}` });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? err.stack : undefined;
          console.error("[eq-format-api]", message, stack);
          return sendJson(res, 500, { error: message });
        }
      });
    },
  };
}
