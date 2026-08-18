import { z } from "zod";
import { loadRoleCredentialsFromSsm } from "./secrets/ssmRoleCredentials.js";

// One entry per roster agent. `bearerTokens` holds two entries during a
// rotation overlap (ADR-0046 §Auth) and one otherwise. Production values
// come from SSM (infra#240's boundary); locally, from AGENT_MEMORY_ROLE_CREDENTIALS
// in .envrc.local — never a real Neon connection_uri.
const RoleCredentialSchema = z.object({
  role: z.string().min(1),
  bearerTokens: z.array(z.string().min(1)).min(1),
  databaseUrl: z.string().min(1),
});
export type RoleCredential = z.infer<typeof RoleCredentialSchema>;

const RoleCredentialsSchema = z.array(RoleCredentialSchema).min(1);

// AGENT_MEMORY_ROLE_CREDENTIALS (raw JSON) wins when set — local dev and
// every test in this repo use it. Its absence, plus AGENT_MEMORY_SSM_READ_ROLE_ARN
// present, means this is the deployed Cloud Run service: fetch from SSM via
// the GCP→AWS federation instead (infra#240).
export async function loadRoleCredentials(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RoleCredential[]> {
  const raw = env.AGENT_MEMORY_ROLE_CREDENTIALS;
  if (raw) {
    return RoleCredentialsSchema.parse(JSON.parse(raw));
  }

  const ssmReadRoleArn = env.AGENT_MEMORY_SSM_READ_ROLE_ARN;
  const rolesCsv = env.AGENT_MEMORY_ROLES;
  const awsRegion = env.AGENT_MEMORY_AWS_REGION;
  if (!ssmReadRoleArn || !rolesCsv || !awsRegion) {
    throw new Error(
      "no credential source configured: set AGENT_MEMORY_ROLE_CREDENTIALS (local/test), or AGENT_MEMORY_SSM_READ_ROLE_ARN + AGENT_MEMORY_ROLES + AGENT_MEMORY_AWS_REGION (deployed)",
    );
  }
  const credentials = await loadRoleCredentialsFromSsm({
    roles: rolesCsv.split(",").map((r) => r.trim()),
    ssmReadRoleArn,
    awsRegion,
    oidcAudience: env.AGENT_MEMORY_SSM_OIDC_AUDIENCE,
  });
  return RoleCredentialsSchema.parse(credentials);
}
