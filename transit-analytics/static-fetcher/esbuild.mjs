import { build } from "esbuild";
import { rm } from "node:fs/promises";
import { lambdaBuildOptions } from "../esbuild.shared.mjs";

await rm("dist", { force: true, recursive: true });
await build({
  ...lambdaBuildOptions,
  entryPoints: {
    index: "handler.ts",
  },
  outdir: "dist",
});
