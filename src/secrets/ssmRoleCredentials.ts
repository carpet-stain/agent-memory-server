import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { fromWebToken } from "@aws-sdk/credential-providers";
import type { RoleCredential } from "../config.js";
import { fetchGcpIdentityToken } from "./gcpIdentityToken.js";

export interface SsmSecretsConfig {
  roles: string[];
  ssmReadRoleArn: string; // infra#240's break-glass AWS role: agent-memory-ssm-read
  awsRegion: string;
  // Override only if a trust policy pins a non-default oaud (#30).
  oidcAudience?: string;
}

// agent-memory-ssm-read's trust pins accounts.google.com:oaud to this — the
// value STS expects for AssumeRoleWithWebIdentity (#30, derived in #25).
const DEFAULT_OIDC_AUDIENCE = "sts.amazonaws.com";

const SSM_PATH_PREFIX = "/runtime/agent-memory";

// Fetches each role's connection URI + bearer tokens from SSM once, at
// container boot (infra#240: caching once is what keeps cold p95 inside the
// kill-switch's budget) — never per-request.
export async function loadRoleCredentialsFromSsm(
  cfg: SsmSecretsConfig,
): Promise<RoleCredential[]> {
  const client = await createSsmClient(cfg);
  const results: RoleCredential[] = [];
  for (const role of cfg.roles) {
    const [databaseUrl, bearerTokensJson] = await Promise.all([
      getParameter(client, `${SSM_PATH_PREFIX}/${role}/connection-uri`),
      getParameter(client, `${SSM_PATH_PREFIX}/${role}/bearer-tokens`),
    ]);
    results.push({
      role,
      databaseUrl,
      bearerTokens: JSON.parse(bearerTokensJson) as string[],
    });
  }
  return results;
}

// The registry's refresh path (ADR-0003): re-reads only the bearer-tokens
// parameters, so a rotation reaches running instances without a redeploy.
// Called on a minutes-scale TTL / unknown-token miss, never per-request —
// each call re-federates GCP→AWS, cheap at that cadence.
export async function loadBearerTokensFromSsm(
  cfg: SsmSecretsConfig,
): Promise<Map<string, string[]>> {
  const client = await createSsmClient(cfg);
  const byRole = new Map<string, string[]>();
  for (const role of cfg.roles) {
    const json = await getParameter(
      client,
      `${SSM_PATH_PREFIX}/${role}/bearer-tokens`,
    );
    byRole.set(role, JSON.parse(json) as string[]);
  }
  return byRole;
}

async function createSsmClient(cfg: SsmSecretsConfig): Promise<SSMClient> {
  const webIdentityToken = await fetchGcpIdentityToken(
    cfg.oidcAudience ?? DEFAULT_OIDC_AUDIENCE,
  );
  const credentials = fromWebToken({
    roleArn: cfg.ssmReadRoleArn,
    webIdentityToken,
    roleSessionName: "agent-memory-server",
  });
  return new SSMClient({ region: cfg.awsRegion, credentials });
}

async function getParameter(client: SSMClient, name: string): Promise<string> {
  const res = await client.send(
    new GetParameterCommand({ Name: name, WithDecryption: true }),
  );
  const value = res.Parameter?.Value;
  if (!value) {
    throw new Error(`SSM parameter ${name} has no value`);
  }
  return value;
}
