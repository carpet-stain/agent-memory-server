// Cloud Run's metadata server issues a short-lived OIDC token for the
// runtime service account (infra#240's `cloud-run-agent-memory`). AWS STS
// AssumeRoleWithWebIdentity trades this for temporary AWS credentials —
// reusing ADR-0024's GCP-SA→OIDC→AWS-SSM federation, not a new pattern.
const METADATA_IDENTITY_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

export async function fetchGcpIdentityToken(audience: string): Promise<string> {
  const url = new URL(METADATA_IDENTITY_URL);
  url.searchParams.set("audience", audience);
  url.searchParams.set("format", "full");
  const res = await fetch(url, { headers: { "Metadata-Flavor": "Google" } });
  if (!res.ok) {
    throw new Error(
      `GCP metadata server returned ${String(res.status)} fetching an identity token`,
    );
  }
  return res.text();
}
