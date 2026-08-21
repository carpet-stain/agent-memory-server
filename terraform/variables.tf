variable "agent_role" {
  description = "The roster agent this store belongs to — the first (and today, only) value is \"backlog-manager\"."
  type        = string
  default     = "backlog-manager"
}

variable "neon_region_id" {
  description = "Neon region for this project (see the Neon API's region list)."
  type        = string
  default     = "aws-us-east-1"
}

variable "gcp_project_id" {
  description = "The GCP project infra#240 bootstrapped (Artifact Registry repo, runtime/deploy SAs, WIF)."
  type        = string
}

variable "gcp_region" {
  description = "Cloud Run region — must match the region infra#240's Artifact Registry repo and SAs were bootstrapped in."
  type        = string
  default     = "us-central1"
}

variable "container_image" {
  description = "Fully-qualified Artifact Registry image ref, e.g. us-central1-docker.pkg.dev/<project>/agent-memory/agent-memory-server:<tag>. Supplied by the deploy workflow, not a static default."
  type        = string
}

variable "ssm_read_role_arn" {
  description = "infra#240's agent-memory-ssm-read AWS role ARN — the deployed service assumes this (via GCP-OIDC federation) to read its own secrets from SSM at boot."
  type        = string
}

variable "aws_region" {
  description = "Region for the /runtime/agent-memory/* SSM parameters."
  type        = string
  default     = "us-east-1"
}

variable "ssm_kms_key_id" {
  description = "KMS key for encrypting the SecureString SSM parameters under /runtime/agent-memory/*. Must match what infra#240's agent-memory-ssm-read IAM role was granted kms:Decrypt on."
  type        = string
  default     = "alias/runtime-secrets"
}

variable "bearer_token_count" {
  description = "How many valid bearer tokens to provision (2 during a rotation overlap, 1 otherwise — ADR-0046 §Auth)."
  type        = number
  default     = 1

  validation {
    condition     = var.bearer_token_count == 1 || var.bearer_token_count == 2
    error_message = "bearer_token_count must be 1 (steady state) or 2 (mid-rotation overlap)."
  }
}
