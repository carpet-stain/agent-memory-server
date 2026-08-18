terraform {
  required_version = ">= 1.9.0"

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
    postgresql = {
      source  = "cyrilgdn/postgresql"
      version = "~> 1.20"
    }
  }

  # Backend intentionally unconfigured here — this repo's own CI/deploy
  # workflow supplies it (matches infra's own state-backend pattern). Not
  # applied by this session; see AGENTS.md.
}
