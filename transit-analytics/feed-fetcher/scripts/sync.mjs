// Synchronize environment variable names without copying secret values.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

export async function syncEnvFiles(
  developmentPath = ".env.development",
  examplePath = ".env.example",
) {
  const development = await readFile(developmentPath, "utf8");
  const example = await readFile(examplePath, "utf8").catch((error) => {
    if (error.code === "ENOENT") {
      return "";
    }

    throw error;
  });
  const developmentKeys = Object.keys(parse(development));
  const exampleKeys = new Set(Object.keys(parse(example)));
  const missing = developmentKeys.filter((key) => !exampleKeys.has(key));

  if (missing.length === 0) {
    return;
  }

  const separator = example.length === 0 || example.endsWith("\n") ? "" : "\n";
  const additions = missing.map((key) => `${key}=""`).join("\n");
  await writeFile(examplePath, `${example}${separator}${additions}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await syncEnvFiles();
}
