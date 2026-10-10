import { SecretsProvider } from "@aws-lambda-powertools/parameters/secrets";
import type { CredentialKey } from "./feeds.js";

const secrets = new SecretsProvider();

export function getLocalEnvCredential(key: CredentialKey): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing local credential: ${key}`);
  }
  return value;
}

export async function getSecretsManagerCredential(
  secretArnEnvironmentVariable:
    | "TRAFIKLAB_SECRET_ARN"
    | "OPENTRANSPORTDATA_SECRET_ARN",
  key: CredentialKey,
): Promise<string> {
  const secretArn = process.env[secretArnEnvironmentVariable];
  if (!secretArn) {
    throw new Error(
      `Missing environment variable: ${secretArnEnvironmentVariable}`,
    );
  }

  const values = await secrets.get<Record<string, unknown>>(secretArn, {
    transform: "json",
    maxAge: 300,
  });
  const value = values?.[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing provider credential: ${key}`);
  }
  return value;
}
