/**
 * FormatModuleHost — mounts the EQ Format sheet wrangler.
 *
 * EQ Format is a standalone Vite app (eq-platform/packages/eq-format-ui)
 * with its own Node API server for validation, AI mapping, and derived
 * exports. It can't be imported as a React component — it runs as a
 * separate dev server.
 *
 * In local dev: start the format server with `pnpm -F @eq/format-ui dev`
 * (defaults to http://localhost:5174) then navigate to /format in the shell.
 *
 * This host renders an iframe that embeds the running format server. The
 * iframe URL is controlled by the VITE_FORMAT_UI_URL env var (defaults to
 * the standard dev server port). In production, point this at wherever
 * eq-format-ui is deployed.
 *
 * Keyboard / pointer events work inside the iframe natively. The shell
 * handles auth at its own level; the format tool is intended for internal
 * operators who are already logged in.
 */

const FORMAT_UI_URL =
  (import.meta.env.VITE_FORMAT_UI_URL as string | undefined) ??
  "http://localhost:5174";

export function FormatModuleHost(): JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid var(--eq-border, #E5E7EB)",
          background: "var(--eq-surface, #fff)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontWeight: 700,
            fontSize: 14,
            color: "var(--eq-ink, #1A1A2E)",
            letterSpacing: "-0.01em",
          }}
        >
          EQ Format
        </span>
        <span
          style={{
            fontSize: 12,
            color: "var(--eq-mute, #6B7280)",
          }}
        >
          Sheet wrangler — map, validate, and export any spreadsheet to canonical
        </span>
        <a
          href={FORMAT_UI_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            marginLeft: "auto",
            fontSize: 12,
            color: "var(--eq-sky, #3DA8D8)",
            textDecoration: "none",
          }}
        >
          Open in new tab ↗
        </a>
      </div>
      <iframe
        src={FORMAT_UI_URL}
        title="EQ Format — sheet wrangler"
        style={{
          flex: 1,
          border: "none",
          width: "100%",
          minHeight: 0,
        }}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
