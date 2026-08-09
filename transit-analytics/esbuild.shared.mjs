export const lambdaBuildOptions = {
  bundle: true,
  format: "esm",
  outExtension: {
    ".js": ".mjs",
  },
  platform: "node",
  // https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-using-build-typescript.html#serverless-sam-cli-using-build-typescript-example
  target: "es2020",
  banner: {
    // fix `Dynamic require of "node:https" is not supported`
    // https://github.com/evanw/esbuild/issues/1921#issuecomment-4701899317
    js: `globalThis.require ??= (await import('node:module')).createRequire(import.meta.url);`,
  },
  // during lambda runtime `NODE_OPTIONS="--enable-source-maps"` must be set
  sourcemap: true,
  sourcesContent: false,
};
