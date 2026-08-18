import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { fromWebToken } from "@aws-sdk/credential-providers";
import type { RoleCredential } from "../config.js";
import { fetchGcpIdentityToken } from "./gcpIdentityToken.js";

export interface SsmSecretsConfig {
  roles: string[];
  ssmReadRoleArn: string; // infra#240's break-glass AWS role: agent-memory-ssm-read
  awsRegion: string;
  // Must match whatever audience value AWS IAM's OIDC identity provider
  // trust policy expects for the GCP token (infra#240 doesn't spell this
  // out) — defaults to the role ARN, the common convention, but confirm
  // against the actual trust policy before relying on it.
  oidcAudience?: string;
}

const SSM_PATH_PREFIX = "/runtime/agent-memory";

// Fetches each role's connection URI + bearer tokens from SSM once, at
// container boot (infra#240: caching once is what keeps cold p95 inside the
// kill-switch's budget) — never per-request.
export async function loadRoleCredentialsFromSsm(
  cfg: SsmSecretsConfig,
): Promise<RoleCredential[]> {
  const webIdentityToken = await fetchGcpIdentityToken(
    cfg.oidcAudience ?? cfg.ssmReadRoleArn,
  );
  const credentials = fromWebToken({
    roleArn: cfg.ssmReadRoleArn,
    webIdentityToken,
    roleSessionName: "agent-memory-server-boot",
  });
  const client = new SSMClient({ region: cfg.awsRegion, credentials });

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
