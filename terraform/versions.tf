terraform {
  # OpenTofu range (ADR-0002 decision 1) — tenv resolves and installs from
  # this pin; files stay .tf for tflint's sake.
  required_version = "~> 1.12"

  required_providers {
    neon = {
      source  = "kislerdm/neon"
      version = "~> 0.15"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # R2, not AWS S3 (ADR-0002 decision 2): the endpoint and credentials come
  # from the secret gate — AWS_ENDPOINT_URL_S3 plus the `r2-backend` profile
  # written to AWS_SHARED_CREDENTIALS_FILE — so nothing account-identifying
  # is committed. State/plan encryption is env-only TF_ENCRYPTION; see
  # docs/CODING.md.
  backend "s3" {
    bucket       = "agent-memory-tofu-state"
    key          = "agent-memory-server/terraform.tfstate"
    region       = "auto"
    profile      = "r2-backend"
    use_lockfile = true

    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
    use_path_style              = true
  }
}
