import { build } from "esbuild";
import { rm } from "node:fs/promises";

await rm("dist", { force: true, recursive: true });
await build({
  entryPoints: {
    index: "handler.ts",
  },
  bundle: true,
  format: "esm",
  outExtension: {
    ".js": ".mjs",
  },
  outdir: "dist",
  platform: "node",
  target: "node24",
  sourcemap: true,
  sourcesContent: false,
});
