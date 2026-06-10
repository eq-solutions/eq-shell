import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { applyTenantPalette, readTenantConfig } from "./tenant-config.js";

// Pull the per-tenant config from env vars + apply the brand palette as
// CSS custom properties before React mounts. Title gets set so the tab
// shows e.g. "EQ — SKS Technologies".
const tenant = readTenantConfig();
applyTenantPalette(tenant.palette);
document.title = `EQ — ${tenant.name}`;

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing in index.html");

createRoot(root).render(
  <StrictMode>
    <App tenant={tenant} />
  </StrictMode>,
);
