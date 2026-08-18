import { build } from "esbuild";
import { rm } from "node:fs/promises";

await rm("dist", { force: true, recursive: true });
await build({
  bundle: true,
  format: "esm",
  outExtension: {
    ".js": ".mjs",
  },
  platform: "node",
  target: "es2020",
  sourcemap: true,
  sourcesContent: false,
  entryPoints: {
    index: "index.ts",
  },
  outdir: "dist",
});
