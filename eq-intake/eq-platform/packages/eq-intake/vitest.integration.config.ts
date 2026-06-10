import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.integration.test.ts"],
    environment: "node",
    globals: false,
    // Vision calls can take 10-30s per PDF; give the suite room.
    testTimeout: 180_000,
    setupFiles: ["./test/integration-setup.ts"],
  },
});
