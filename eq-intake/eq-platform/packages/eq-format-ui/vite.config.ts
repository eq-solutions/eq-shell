import { defineConfig } from "vite";
import { apiPlugin } from "./src/server.js";

export default defineConfig({
  plugins: [apiPlugin()],
  server: {
    port: 5173,
    strictPort: true,   // fail loud rather than silently shifting ports
    host: true,         // bind 0.0.0.0 so 127.0.0.1, ::1, and WSL-host all work
    open: true,         // pop a browser tab on start
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
