# The google_cloud_run_v2_service resource itself — consumer-owned per
# infra#240's boundary (infra bootstraps the Artifact Registry repo, the
# runtime/deploy SAs, and WIF; this repo owns the Service that uses them).

locals {
  # infra#240 fixes the runtime SA's name — derived, not a variable, so it
  # can't drift from gcp_project_id.
  runtime_service_account_email = "cloud-run-agent-memory@${var.gcp_project_id}.iam.gserviceaccount.com"
}

resource "google_cloud_run_v2_service" "this" {
  name     = "agent-memory-${var.agent_role}"
  location = var.gcp_region
  project  = var.gcp_project_id

  deletion_protection = true

  # Locked to the Cloudflare-fronted load balancer infra#250 sets up post-
  # deploy — raw *.run.app stays unreachable (infra#240's cost-DoS fence).
  ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    service_account = local.runtime_service_account_email

    # min_instance_count = 0 is load-bearing, not a default left alone:
    # infra#240 flags min-instance escalation as itself tripping the cost
    # kill-switch this service exists under.
    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    containers {
      image = var.container_image

      ports {
        container_port = 8080
      }

      env {
        name  = "AGENT_MEMORY_SSM_READ_ROLE_ARN"
        value = var.ssm_read_role_arn
      }
      env {
        name  = "AGENT_MEMORY_ROLES"
        value = var.agent_role
      }
      env {
        name  = "AGENT_MEMORY_AWS_REGION"
        value = var.aws_region
      }

      startup_probe {
        http_get {
          path = "/healthz"
        }
        initial_delay_seconds = 1
        period_seconds        = 2
        failure_threshold     = 5
      }
    }
  }
}
