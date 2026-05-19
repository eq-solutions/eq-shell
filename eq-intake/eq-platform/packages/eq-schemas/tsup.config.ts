import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: false, // preserve src/generated between builds
  sourcemap: true,
  target: "es2022",
  outDir: "dist",
  splitting: false,
  // src/generated must exist before tsup runs; the build script ensures this
  // via the chained `pnpm generate && tsup` in package.json.
});
