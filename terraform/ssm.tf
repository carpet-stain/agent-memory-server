# /runtime/agent-memory/* — this repo's own state, not infra's ssm.tf (which
# explicitly excludes /runtime/* — infra#204's boundary). The deployed
# Cloud Run service reads these once at boot via the agent-memory-ssm-read
# role (infra#240), never per-request.
provider "aws" {
  region = var.aws_region
}

resource "random_password" "bearer_token" {
  count   = var.bearer_token_count
  length  = 48
  special = false
}

resource "aws_ssm_parameter" "connection_uri" {
  name   = "/runtime/agent-memory/${var.agent_role}/connection-uri"
  type   = "SecureString"
  key_id = var.ssm_kms_key_id
  value  = local.connection_uri
}

resource "aws_ssm_parameter" "bearer_tokens" {
  name   = "/runtime/agent-memory/${var.agent_role}/bearer-tokens"
  type   = "SecureString"
  key_id = var.ssm_kms_key_id
  value  = jsonencode(random_password.bearer_token[*].result)
}
