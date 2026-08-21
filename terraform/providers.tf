provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

# api_key intentionally omitted — the provider reads NEON_API_KEY from the
# environment, sourced from /cicd/agent-memory/neon-api-key (infra#272's
# /cicd tier). Never put it in a .tf variable.
provider "neon" {}
