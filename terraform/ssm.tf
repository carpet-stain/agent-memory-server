# /runtime/agent-memory/* — this repo's own state, not infra's ssm.tf (which
# explicitly excludes /runtime/* — infra#204's boundary). The deployed
# Cloud Run service reads these via the agent-memory-ssm-read role
# (infra#240) at boot — bearer-tokens again on a minutes-scale TTL
# (ADR-0003) — never per-request.
provider "aws" {
  region = var.aws_region
}

locals {
  # Two rotation slots (ADR-0003): bearer-rotate.yml -replaces the older
  # slot weekly, so the untouched slot is the overlap's still-valid
  # previous token. A missed run can only extend a token's life, never
  # rotate both slots at once.
  bearer_slots = toset(["a", "b"])
}

resource "random_password" "bearer_token" {
  for_each = local.bearer_slots
  length   = 48
  special  = false
}

# Mint timestamp per slot, recreated whenever its token is — how the
# rotation workflow finds the older slot and how the SSM value orders
# newest-first.
resource "time_static" "bearer_minted" {
  for_each = local.bearer_slots
  triggers = {
    token = random_password.bearer_token[each.key].result
  }
}

# Pre-rotation state held a single count-indexed token (issue #32).
moved {
  from = random_password.bearer_token[0]
  to   = random_password.bearer_token["a"]
}

locals {
  # Newest-first: clients take the head; the tail stays valid through the
  # overlap. unix, not rfc3339 — HCL comparison operators take numbers
  # only. Ties (both slots minted in the first apply's second) break to
  # "a", which is fine — both are equally fresh.
  bearer_tokens_newest_first = (
    time_static.bearer_minted["a"].unix >= time_static.bearer_minted["b"].unix
    ? [random_password.bearer_token["a"].result, random_password.bearer_token["b"].result]
    : [random_password.bearer_token["b"].result, random_password.bearer_token["a"].result]
  )
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
  value  = jsonencode(local.bearer_tokens_newest_first)
}
