import { build } from "esbuild";
import { rm, writeFile } from "node:fs/promises";
import { lambdaBuildOptions } from "../esbuild.shared.mjs";

await rm("dist", { force: true, recursive: true });
await build({
  ...lambdaBuildOptions,
  entryPoints: {
    index: "handler.ts",
  },
  outdir: "dist",
});

const registry = await build({
  entryPoints: ["../shared/feeds.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { realtimeFeeds } = await import(
  `data:text/javascript;base64,${Buffer.from(registry.outputFiles[0].contents).toString("base64")}`
);
await writeFile(
  "dist/realtime-feeds.json",
  JSON.stringify(Object.fromEntries(Object.entries(realtimeFeeds).map(
    ([key, feed]) => [key, feed.minimumPollIntervalSeconds],
  )), null, 2) + "\n",
);
