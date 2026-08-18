provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

# api_key intentionally omitted — the provider reads NEON_API_KEY from the
# environment (ADR-0046 step 1: exported into this repo's CI apply-env from
# /infra/neon-api-key). Never put it in a .tf variable.
provider "neon" {}
